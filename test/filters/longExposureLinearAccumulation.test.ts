import { describe, expect, it } from "vitest";
import {
  linearToSrgb,
  srgbToLinear,
} from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

// Long Exposure is WebGL2-only, so its shader math cannot execute under jsdom.
// This test pins the property the shaders now guarantee: slow-shutter
// accumulation is integration of photon flux, so frames must be averaged in
// LINEAR light and re-encoded to sRGB once — a linear average of a bright and a
// dark frame is brighter than the naive gamma-space average of the same bytes.
// (Framework-free scalar mirror of SHUTTER_FS / ACCUM_FS, sharing the exact
// EOTF the GLSL uses via SRGB_GLSL.)

const N = 255;

/** Shader-correct: average two sRGB channels in linear, re-encode to sRGB. */
const linearAvg = (a: number, b: number): number =>
  linearToSrgb((srgbToLinear(a / N) + srgbToLinear(b / N)) / 2) * N;

/** The old, wrong path: average the sRGB bytes directly (gamma space). */
const gammaAvg = (a: number, b: number): number => (a + b) / 2;

describe("Long Exposure: linear-light accumulation", () => {
  it("linear shutter-average of a bright+dark frame is brighter than the gamma average", () => {
    const bright = 240;
    const dark = 16;
    const lin = linearAvg(bright, dark);
    const gamma = gammaAvg(bright, dark); // == 128

    // Gamma averaging crushes the midtone; correct integration is brighter.
    expect(lin).toBeGreaterThan(gamma + 5);
  });

  it("holds across the tonal range (linear >= gamma, strict in the midtones)", () => {
    for (const [a, b] of [
      [255, 0],
      [200, 40],
      [128, 64],
      [96, 32],
    ]) {
      expect(linearAvg(a, b)).toBeGreaterThan(gammaAvg(a, b));
    }
  });

  it("degenerates correctly: equal frames average to themselves in both spaces", () => {
    for (const v of [0, 32, 128, 200, 255]) {
      expect(linearAvg(v, v)).toBeCloseTo(v, 4);
    }
  });
});
