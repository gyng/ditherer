import { describe, expect, it } from "vitest";
import {
  gaussianKernel1D,
  linearToSrgb,
  srgbToLinear,
} from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

// Framework-free mirror of tiltShift.ts's separable-blur + focus-band-mix
// math (src/filters/tiltShift.ts:54-131). No DOM/WebGL is exercised — this
// proves the linear-light formula the shaders now implement actually keeps
// out-of-focus highlights brighter than the old gamma-space blur did, which
// is the property the fix depends on (muddy-bokeh regression guard).

/** 1D separable blur of an sRGB (0..1) signal, sampled once at `at`, run
 * either in gamma/sRGB space (the old, wrong behaviour) or in linear light
 * (the new tiltShift.ts behaviour: linearize -> blur -> encode back). */
const blurAt = (signalSrgb: number[], at: number, kernel: number[], linear: boolean): number => {
  const half = (kernel.length - 1) / 2;
  const samples = linear ? signalSrgb.map(srgbToLinear) : signalSrgb;
  let acc = 0;
  for (let k = -half; k <= half; k++) {
    const idx = Math.min(signalSrgb.length - 1, Math.max(0, at + k));
    acc += samples[idx] * kernel[k + half];
  }
  return linear ? linearToSrgb(acc) : acc;
};

describe("Tilt Shift linear-light defocus (tiltShift.ts shader math mirror)", () => {
  it("keeps an out-of-focus bright highlight over dark brighter than a gamma-space blur would", () => {
    // A single bright highlight (sRGB 1.0) surrounded by near-black (0.02),
    // matching the classic small-light-over-dark-background bokeh case.
    const width = 41;
    const center = 20;
    const signal = Array.from({ length: width }, (_, i) => (i === center ? 1 : 0.02));
    const sigma = 6;
    const kernel = gaussianKernel1D(Math.ceil(sigma * 3), sigma);

    const gammaResult = blurAt(signal, center, kernel, false);
    const linearResult = blurAt(signal, center, kernel, true);

    expect(linearResult).toBeGreaterThan(gammaResult);
    // The gap should be substantial, not a rounding artifact — this is the
    // "muddy bokeh" magnitude, not noise.
    expect(linearResult - gammaResult).toBeGreaterThan(0.05);
  });

  it("keeps the focus-band mix(src, blur, t) brighter in linear than mixing raw sRGB", () => {
    // Sharp source pixel is dark (in-focus foreground edge), the blurred
    // out-of-focus background carries the bright highlight's spread energy.
    const srcSrgb = 0.05;
    const blurSrgbGamma = 0.35; // what an sRGB-space blur would report here
    const blurSrgbLinear = 0.5; // what the linear-space blur reports at the same point (brighter)
    const t = 0.7; // mostly defocused

    const gammaMix = srcSrgb * (1 - t) + blurSrgbGamma * t;

    const srcLin = srgbToLinear(srcSrgb);
    const linearMix = linearToSrgb(srcLin * (1 - t) + srgbToLinear(blurSrgbLinear) * t);

    expect(linearMix).toBeGreaterThan(gammaMix);
  });

  it("round-trips a flat field through the linear blur unchanged (no color-space DC shift)", () => {
    const width = 21;
    const signal = Array.from({ length: width }, () => 0.4);
    const kernel = gaussianKernel1D(9, 3);
    const result = blurAt(signal, 10, kernel, true);
    expect(result).toBeCloseTo(0.4, 6);
  });
});
