import { describe, expect, it } from "vitest";

import { colorDistance, rgba2hsva } from "utils";
import { HSV_NEAREST } from "constants/color";

// Regression: HSV distance used to divide the value term by 255 on top of
// rgba2hsva already returning V in 0..1 — so brightness contributed ~1/65000 of
// what hue and saturation did, and was effectively a tiebreaker rather than an
// equal axis.
//
// The tell was that orderedGL's in-shader HSV distance never had the divisor
// (`float dvv = abs(aux.z - pa.z);`), so GL and CPU disagreed on every HSV
// palette. The shader was right.

describe("rgba2hsva ranges — what the distance assumes", () => {
  it("returns V in 0..1, not 0..255", () => {
    // This is the whole reason the /255 was wrong. If V ever becomes 0..255,
    // the distance needs rescaling and these tests should fail loudly.
    expect(rgba2hsva([255, 255, 255, 255])[2]).toBe(1);
    expect(rgba2hsva([0, 0, 0, 255])[2]).toBe(0);
    expect(rgba2hsva([128, 128, 128, 255])[2]).toBeCloseTo(128 / 255, 6);
  });

  it("returns S in 0..1 and H in 0..360", () => {
    expect(rgba2hsva([255, 0, 0, 255])[0]).toBe(0);
    expect(rgba2hsva([0, 255, 0, 255])[0]).toBe(120);
    expect(rgba2hsva([0, 0, 255, 255])[0]).toBe(240);
    expect(rgba2hsva([255, 0, 0, 255])[1]).toBe(1);
    expect(rgba2hsva([128, 128, 128, 255])[1]).toBe(0);
  });
});

describe("HSV distance weighs all three axes comparably", () => {
  it("black to white is a full unit apart, not ~0", () => {
    // Was 0.0000154. Both differ only in V, which spans its whole range.
    expect(colorDistance([0, 0, 0, 255], [255, 255, 255, 255], HSV_NEAREST)).toBeCloseTo(1, 6);
  });

  it("a pure value difference scores like a pure saturation difference", () => {
    // black->white is V across its full range; red->white is S across its full
    // range. Neither axis should dominate the other.
    const byValue = colorDistance([0, 0, 0, 255], [255, 255, 255, 255], HSV_NEAREST);
    const bySat = colorDistance([255, 0, 0, 255], [255, 255, 255, 255], HSV_NEAREST);
    expect(byValue).toBeCloseTo(bySat, 6);
  });

  it("a pure hue difference is comparable too", () => {
    // Opposite hues at full saturation and value: dH = 180/180 = 1.
    expect(colorDistance([255, 0, 0, 255], [0, 255, 255, 255], HSV_NEAREST)).toBeCloseTo(1, 6);
  });

  it("brightness actually decides a match when hue and saturation tie", () => {
    // The user-visible symptom. Against [white, dark olive], black used to match
    // WHITE — the worst available answer — because white shares its hue and
    // saturation (both achromatic) and the value gap scored 0.0000154.
    const toWhite = colorDistance([255, 255, 255, 255], [0, 0, 0, 255], HSV_NEAREST);
    const toOlive = colorDistance([60, 60, 20, 255], [0, 0, 0, 255], HSV_NEAREST);
    expect(toOlive).toBeLessThan(toWhite);
  });

  it("hue still wraps the short way around", () => {
    // 350 and 10 degrees are 20 apart, not 340.
    const near = colorDistance([255, 0, 21, 255], [255, 21, 0, 255], HSV_NEAREST);
    expect(near).toBeLessThan(0.05);
  });

  it("identical colours are zero distance", () => {
    expect(colorDistance([12, 34, 56, 255], [12, 34, 56, 255], HSV_NEAREST)).toBe(0);
  });
});
