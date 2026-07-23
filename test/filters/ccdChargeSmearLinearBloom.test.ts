import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual };
});

import { linearToSrgb, srgbToLinear } from "filters/opticalConvolutionContracts";

// ccdChargeSmear.ts is requiresGL:true with no CPU fallback, and jsdom has no
// WebGL2, so the shader itself can't run here (see gl-smoke for the real-GPU
// pixel check). This mirrors the post-fix fragment shader math in pure JS,
// reusing the same sRGB<->linear pair (srgbToLinear/linearToSrgb) whose GLSL
// twins (oc_srgbToLinear/oc_linearToSrgb) are spliced into the shader via
// SRGB_GLSL, to pin the linear-light full-well behaviour the fix introduces.
const LUMA = [0.2126, 0.7152, 0.0722] as const;
type Rgb = [number, number, number];

const lumaOf = ([r, g, b]: Rgb): number => r * LUMA[0] + g * LUMA[1] + b * LUMA[2];

// Post-fix: threshold, luma, and excess are all computed in linear light.
const excessLinear = (c: Rgb, thresholdGamma: number): number => {
  const cLin: Rgb = [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
  const thresholdLin = srgbToLinear(thresholdGamma);
  return Math.max(0, lumaOf(cLin) - thresholdLin) / Math.max(0.001, 1 - thresholdLin);
};

// Pre-fix (buggy): the same formula but directly on gamma-encoded values.
const excessGammaBuggy = (c: Rgb, thresholdGamma: number): number =>
  Math.max(0, lumaOf(c) - thresholdGamma) / Math.max(0.001, 1 - thresholdGamma);

const makeColumnFixture = (brightGamma: number, darkGamma: number, rows: number): Rgb[] => {
  const column: Rgb[] = [[brightGamma, brightGamma, brightGamma]];
  for (let i = 1; i < rows; i += 1) column.push([darkGamma, darkGamma, darkGamma]);
  return column;
};

// Mirrors the shader's DOWN branch (u_direction==0): pixel row r gathers
// weighted excess from the pixel `i` rows above it (row r-i), matching the
// driver's own comment that DOWN "gathers overload from the higher texture
// coordinate". spectralRatio is 1 here because every fixture pixel is
// neutral (r=g=b), isolating the excess/luma behaviour under test.
const accumulateDownColumn = (
  column: Rgb[],
  threshold: number,
  decay: number,
  length: number,
  linear: boolean,
): number[] =>
  column.map((_, r) => {
    let spilled = 0;
    for (let i = 1; i <= length; i += 1) {
      const sampleRow = r - i;
      if (sampleRow < 0) continue;
      const c = column[sampleRow];
      const weight = decay ** i;
      spilled += (linear ? excessLinear(c, threshold) : excessGammaBuggy(c, threshold)) * weight;
    }
    return spilled;
  });

describe("CCD Charge Smear — linear-light full-well overflow", () => {
  const threshold = 0.6;
  const decay = 0.85;
  const length = 6;
  const brightGamma = 192 / 255;
  const darkGamma = 16 / 255;

  it("estimates overflow excess from linear luma, not gamma luma", () => {
    const c: Rgb = [brightGamma, brightGamma, brightGamma];
    const linear = excessLinear(c, threshold);
    const gamma = excessGammaBuggy(c, threshold);

    // sRGB mid-tones sit above their linear-light value, so the old
    // gamma-space excess overstates how much a pixel has overflowed relative
    // to the physically correct linear estimate.
    expect(linear).toBeGreaterThan(0);
    expect(linear).toBeLessThan(gamma);
    expect(linear).toBeCloseTo(0.306, 3);
    expect(gamma).toBeCloseTo(0.382, 3);
  });

  it("produces a linear-weighted bloom trail decaying geometrically below the bright pixel", () => {
    const column = makeColumnFixture(brightGamma, darkGamma, 8);
    const trail = accumulateDownColumn(column, threshold, decay, length, true);
    const expectedTap = excessLinear(column[0], threshold);

    expect(trail[0]).toBe(0); // the source pixel itself gathers nothing (no i=0 tap)
    for (let r = 1; r <= length; r += 1) {
      expect(trail[r]).toBeGreaterThan(0);
      // Only the bright row0 tap contributes (dark rows are below threshold),
      // so row r's spill is exactly the linear excess weighted by decay^r.
      expect(trail[r]).toBeCloseTo(expectedTap * decay ** r, 6);
    }
    for (let r = length + 1; r < column.length; r += 1) {
      expect(trail[r]).toBe(0); // beyond `length`, no more spill reaches the pixel
    }
    for (let r = 2; r <= length; r += 1) {
      expect(trail[r]).toBeLessThan(trail[r - 1]); // monotonic geometric decay
    }
  });

  it("would accumulate a different (wrong) trail under the old gamma-space math", () => {
    const column = makeColumnFixture(brightGamma, darkGamma, 8);
    const linearTrail = accumulateDownColumn(column, threshold, decay, length, true);
    const gammaTrail = accumulateDownColumn(column, threshold, decay, length, false);

    for (let r = 1; r <= length; r += 1) {
      expect(linearTrail[r]).not.toBeCloseTo(gammaTrail[r], 6);
      expect(linearTrail[r]).toBeLessThan(gammaTrail[r]);
    }
  });

  it("preserves the zero-strength round trip (matches the guarded zero-strength-identity gl-smoke contract)", () => {
    for (const v of [0, 0.01, 0.25, brightGamma, 0.99, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
    }
  });
});
