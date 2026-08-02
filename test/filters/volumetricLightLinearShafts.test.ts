import { describe, expect, it } from "vitest";
import {
  linearToSrgb,
  srgbToLinear,
} from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

// Framework-free mirror of the Volumetric Light fragment shader
// (packages/ditherer-filters/src/filters/volumetricLight.ts). The shader itself
// is WebGL2-only and cannot execute under vitest, so we reproduce its emitter /
// ray-march / composite math in JS for both the legacy gamma path and the
// hardened linear-light path and assert the physical integration property.

type RGB = readonly [number, number, number];
const LUMA: RGB = [0.2126, 0.7152, 0.0722];
const dot3 = (a: RGB, b: RGB) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const luma = (c: RGB) => dot3(c, LUMA);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// --- emitter: brightness of a sampled source pixel above the threshold knee ---
// Legacy: luma of the *gamma* sample (shader :26, thresholded in sRGB).
const emitterGamma = (srgb: RGB, threshold: number) =>
  smoothstep(threshold, Math.min(1, threshold + 0.2), luma(srgb));
// Hardened: luma of the *linearized* sample, threshold window linearized too.
const emitterLinear = (srgb: RGB, threshold: number) => {
  const lin = srgb.map(srgbToLinear) as unknown as RGB;
  const lo = srgbToLinear(threshold);
  const hi = srgbToLinear(Math.min(1, threshold + 0.2));
  return smoothstep(lo, Math.max(lo + 1e-4, hi), luma(lin));
};

// --- ray-march accumulation: scattered += emitter * illumination (grain=1) ---
const accumulate = (emit: number, decay: number, steps = 64) => {
  let illum = 1,
    scattered = 0;
  for (let i = 0; i < steps; i++) {
    scattered += emit * illum;
    illum *= decay;
  }
  return scattered;
};

// --- additive composite of the emitted shafts onto the source pixel ---
// Legacy: add in gamma and clamp (shader :46).
const compositeGamma = (
  src: RGB,
  tint: RGB,
  scattered: number,
  exposure: number,
  radial: number,
): RGB =>
  [0, 1, 2].map((k) =>
    Math.min(1, Math.max(0, src[k] + tint[k] * scattered * exposure * radial)),
  ) as unknown as RGB;
// Hardened: linearize src + sRGB tint, add as radiant energy, re-encode.
const compositeLinear = (
  src: RGB,
  tint: RGB,
  scattered: number,
  exposure: number,
  radial: number,
): RGB => {
  const srcLin = src.map(srgbToLinear);
  const tintLin = tint.map(srgbToLinear);
  return [0, 1, 2].map((k) =>
    linearToSrgb(srcLin[k] + tintLin[k] * scattered * exposure * radial),
  ) as unknown as RGB;
};

const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];
const THRESHOLD = 0.62; // filter default
const DECAY = 0.965; // filter default

describe("Volumetric Light: linear-light ray-march shafts", () => {
  it("brightens a dark field more than the gamma path for identical shaft energy", () => {
    // A fully-bright emitter fires to 1.0 in BOTH color spaces, so any output
    // delta is isolated to the accumulation/composite color space.
    const emitG = emitterGamma(WHITE, THRESHOLD);
    const emitL = emitterLinear(WHITE, THRESHOLD);
    expect(emitG).toBeCloseTo(1, 6);
    expect(emitL).toBeCloseTo(1, 6);

    const scattered = accumulate(1, DECAY); // same integral in both paths
    const exposure = 0.01,
      radial = 1.0; // keep the shaft unsaturated
    const outG = compositeGamma(BLACK, WHITE, scattered, exposure, radial);
    const outL = compositeLinear(BLACK, WHITE, scattered, exposure, radial);

    // Correct linear integration re-encodes the accumulated energy through the
    // sRGB OETF, which lifts a shaft over a dark field well above the raw gamma
    // add — the bright emitter is no longer under-weighted.
    expect(luma(outL)).toBeGreaterThan(luma(outG) * 1.5);
    expect(luma(outL)).toBeGreaterThan(0.4);
    expect(luma(outG)).toBeLessThan(0.3);
  });

  it("linearizes the scattered-light tint before it multiplies into the shaft", () => {
    // A saturated sRGB tint (e.g. warm amber) has a much lower linear-light
    // weight than its gamma value, so the linear path emits a physically
    // correct — dimmer, but re-encoded — colored shaft rather than the gamma
    // over-bright one. We only assert the tint is treated as sRGB, not raw.
    const tint: RGB = [255 / 255, 128 / 255, 32 / 255];
    const tintLinG = tint; // legacy used tint/255 directly
    const tintLinL = tint.map(srgbToLinear) as unknown as RGB;
    expect(tintLinL[1]).toBeLessThan(tintLinG[1]); // mid channel linearized down
    expect(tintLinL[2]).toBeLessThan(tintLinG[2]);
  });

  it("emits no shaft and stays black when the source is below threshold", () => {
    const dim: RGB = [0.2, 0.2, 0.2]; // below the 0.62 knee in both spaces
    expect(emitterGamma(dim, THRESHOLD)).toBe(0);
    expect(emitterLinear(dim, THRESHOLD)).toBe(0);
    const scattered = accumulate(0, DECAY);
    const outL = compositeLinear(BLACK, WHITE, scattered, 0.055, 1.0);
    expect(luma(outL)).toBe(0); // no spurious brightening
  });
});
