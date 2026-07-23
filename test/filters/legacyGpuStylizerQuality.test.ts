import { describe, expect, it } from "vitest";
import {
  defaults as facetDefaults,
  optionTypes as facetOptionTypes,
} from "filters/facet";
import {
  defaults as lensFlareDefaults,
  lensFlareGhostPosition,
  optionTypes as lensFlareOptionTypes,
} from "filters/lensFlare";
import {
  defaults as popArtDefaults,
  optionTypes as popArtOptionTypes,
  popArtSpotGeometry,
} from "filters/popArt";

describe("Pop Art spot geometry", () => {
  it("maps light and mid tones to circular area rather than linear radius", () => {
    const pitch = 100;
    const quarter = popArtSpotGeometry(0.25, pitch);
    const half = popArtSpotGeometry(0.5, pitch);
    expect(quarter.mode).toBe("DOT");
    expect(half.mode).toBe("DOT");
    expect(Math.PI * quarter.radius ** 2 / pitch ** 2).toBeCloseTo(0.25, 10);
    expect(Math.PI * half.radius ** 2 / pitch ** 2).toBeCloseTo(0.5, 10);
    expect(half.radius / quarter.radius).toBeCloseTo(Math.sqrt(2), 10);
  });

  it("switches to complementary holes after round dots contact", () => {
    const pitch = 100;
    const contact = popArtSpotGeometry(Math.PI / 4, pitch);
    const shadow = popArtSpotGeometry(0.9, pitch);
    const black = popArtSpotGeometry(1, pitch);
    expect(contact).toMatchObject({ mode: "DOT", radius: 50 });
    expect(shadow.mode).toBe("HOLE");
    expect(Math.PI * shadow.radius ** 2 / pitch ** 2).toBeCloseTo(0.1, 10);
    expect(black).toEqual({ mode: "HOLE", radius: 0 });
  });

  it("sanitizes malformed tone and pitch values", () => {
    for (const geometry of [
      popArtSpotGeometry(Number.NaN, Number.NaN),
      popArtSpotGeometry(Number.POSITIVE_INFINITY, 0),
      popArtSpotGeometry(-2, -8),
    ]) {
      expect(Number.isFinite(geometry.radius)).toBe(true);
      expect(geometry.radius).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Lens Flare optical-axis layout", () => {
  it("places a multi-ghost sequence on both sides of image center", () => {
    const positions = Array.from({ length: 5 }, (_, index) =>
      lensFlareGhostPosition([20, 30], [100, 80], index, 5, 1));
    expect(positions[0][0]).toBeLessThan(100);
    expect(positions.at(-1)?.[0]).toBeGreaterThan(100);
    for (const [x, y] of positions) {
      const sourceSlope = (80 - 30) / (100 - 20);
      expect((y - 30) / (x - 20)).toBeCloseTo(sourceSlope, 10);
    }
  });

  it("keeps spread centered and finite for malformed state", () => {
    expect(lensFlareGhostPosition([20, 30], [100, 80], 1, 3, 0)).toEqual([100, 80]);
    for (const value of lensFlareGhostPosition(
      [Number.NaN, Number.POSITIVE_INFINITY],
      [Number.NaN, Number.NEGATIVE_INFINITY],
      Number.NaN,
      0,
      Number.NaN,
    )) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("legacy GPU stylizer option contracts", () => {
  it("exposes described controls and non-destructive defaults", () => {
    expect(lensFlareOptionTypes).toMatchObject({
      bloomRadius: expect.any(Object),
      ghostSpread: expect.any(Object),
      streakStrength: expect.any(Object),
      chromaticSpread: expect.any(Object),
    });
    expect(popArtOptionTypes).toMatchObject({
      screenAngle: expect.any(Object),
      paperColor: expect.any(Object),
    });
    expect(facetOptionTypes).toMatchObject({ seed: expect.any(Object) });
    for (const surface of [lensFlareOptionTypes, popArtOptionTypes, facetOptionTypes]) {
      for (const [name, option] of Object.entries(surface)) {
        if (name === "palette") continue;
        expect(option.desc, name).toBeTruthy();
      }
    }
    expect(lensFlareDefaults.intensity).toBeLessThanOrEqual(1);
    expect(popArtDefaults.palette.options.levels).toBe(256);
    expect(facetOptionTypes.fillMode.options[0]).toMatchObject({ name: "Local mean" });
    expect(facetDefaults.seed).toBeTypeOf("number");
  });
});
