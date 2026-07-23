import { describe, expect, it } from "vitest";
import {
  linearToSrgb,
  srgbToLinear,
} from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

// Framework-free mirrors of the halationGL composite operator. Halation is a
// light-diffusion process: the screen blend 1-(1-a)*(1-b) models light being
// added by the film base re-exposing the emulsion, which is only physical on
// LINEAR radiances. These mirror the two colour-space regimes so we can assert
// the property without a WebGL context.

// OLD behaviour: screen the glow straight onto the sRGB source, output sRGB.
const gammaScreen = (srcSrgb: number, glow: number): number =>
  1 - (1 - srcSrgb) * (1 - glow);

// NEW behaviour (mirrors COMPOSITE_FS): source -> linear, screen the glow in
// linear light, then encode back to sRGB.
const linearScreen = (srcSrgb: number, glow: number): number => {
  const sLin = srgbToLinear(srcSrgb);
  const screen = 1 - (1 - sLin) * (1 - glow);
  return linearToSrgb(Math.min(1, Math.max(0, screen)));
};

describe("Halation linear-light screen composite", () => {
  it("lifts a dark background pixel more than a gamma-space screen (brighter glow spread)", () => {
    const glow = 0.3; // moderate halation glow bleeding onto a dark field
    for (const dark of [0.0, 0.04, 0.08, 0.15]) {
      const lin = linearScreen(dark, glow);
      const gam = gammaScreen(dark, glow);
      // In linear light a dark source is far darker, so (1-sLin)~1 lets more of
      // the glow through — the re-encoded lift is visibly brighter than the
      // naive gamma screen would produce.
      expect(lin).toBeGreaterThan(gam + 0.1);
    }
  });

  it("matches the GLSL contract: screen computed in linear then sRGB-encoded", () => {
    const src = 0.2, glow = 0.35;
    const expected = linearToSrgb(1 - (1 - srgbToLinear(src)) * (1 - glow));
    expect(linearScreen(src, glow)).toBeCloseTo(expected, 12);
  });

  it("stays clamped: a white source screens to white, and glow cannot exceed 1", () => {
    expect(linearScreen(1, 0.5)).toBeCloseTo(1, 6); // white stays white
    expect(linearScreen(0.5, 5)).toBeLessThanOrEqual(1); // over-driven glow clamps
    expect(linearScreen(0.5, 5)).toBeCloseTo(1, 6);
  });

  it("is monotonic in the glow amount over a fixed source", () => {
    const src = 0.1;
    let prev = -1;
    for (const g of [0, 0.1, 0.25, 0.5, 0.9]) {
      const out = linearScreen(src, g);
      expect(out).toBeGreaterThan(prev);
      prev = out;
    }
  });
});
