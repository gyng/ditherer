import { describe, expect, it } from "vitest";

import { rgba2laba, rgba2oklaba } from "utils";
import { LAB_NEAREST, OKLAB_NEAREST, RGB_NEAREST } from "constants/color";
import user from "palettes/user";

// Both Lab conversions read an sRGB→linear LUT indexed 0..255. Nothing rounded
// the index, so a fractional channel — which is what error diffusion actually
// carries, since it accumulates quantization error as floats — missed the LUT
// and the `?? 0` fallback silently returned linear *black*.
//
// The failure mode is what makes this worth pinning: it never threw and never
// produced an obviously broken pixel. Every colour simply matched to whichever
// palette entry sits nearest black, so a 6-colour Floyd-Steinberg collapsed to
// 2 colours and just looked like a dark dither.
//
// These assert on the palette match, not on the LUT helper. A test that only
// checked `srgbToLinearF(250.4)` would pass against an implementation that
// rounds correctly and is then never called by the code that needs it.

const CGA = [
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [255, 0, 0, 255],
  [0, 0, 255, 255],
  [0, 255, 0, 255],
  [255, 255, 0, 255],
];

const match = (pixel: number[], algo: string) =>
  user.getColor(pixel, { colors: CGA, colorDistanceAlgorithm: algo } as never);

describe("fractional channels in the sRGB→linear LUT", () => {
  // A saturated red must match red. Under the bug it matched black — and black
  // is a real palette entry, so the result was plausible, just wrong.
  it.each([
    ["Lab", LAB_NEAREST],
    ["OKLab", OKLAB_NEAREST],
  ])("%s matches a fractional pixel to the same entry as its integer twin", (_name, algo) => {
    expect(match([250.4, 40.4, 40.4, 255], algo)).toEqual([255, 0, 0, 255]);
    expect(match([250.4, 40.4, 40.4, 255], algo)).toEqual(match([250, 40, 40, 255], algo));
  });

  // RGB never used the LUT, so it was always correct here. It's the control:
  // if this ever fails, the fixture is wrong, not the conversion.
  it("RGB is unaffected", () => {
    expect(match([250.4, 40.4, 40.4, 255], RGB_NEAREST)).toEqual([255, 0, 0, 255]);
  });

  // Error diffusion pushes channels past both ends of the range before the
  // palette sees them; those must clamp to the endpoints, not fall back to 0.
  it.each([
    ["Lab", LAB_NEAREST],
    ["OKLab", OKLAB_NEAREST],
  ])("%s clamps out-of-range channels instead of reading them as black", (_name, algo) => {
    expect(match([300, 300, 300, 255], algo)).toEqual([255, 255, 255, 255]);
    expect(match([-20, -20, -20, 255], algo)).toEqual([0, 0, 0, 255]);
  });

  // Integer channels are the whole-buffer quantizers' only input and were
  // already correct. Rounding must be identity there or the JS/Rust parity
  // grids drift.
  it("leaves integer channels bit-identical", () => {
    expect(rgba2laba([128, 128, 128, 255])[0]).toBeCloseTo(53.58501354004902, 10);
    // Not exactly 1 — the LUT is f32, so white linearises to 0.99999999. That
    // is the pre-existing shape this fix must not perturb, not a defect.
    expect(rgba2oklaba([255, 255, 255, 255])[0]).toBeCloseTo(1, 7);
  });
});
