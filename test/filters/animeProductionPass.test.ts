import { describe, expect, it } from "vitest";

import {
  animeLookId,
  celBandIndex,
  rimDirection,
  xdogInkResponse,
} from "filters/animeProductionContracts";
import { filterIndex, filterList } from "filters/index";

describe("anime color-script looks", () => {
  it("resolves every supported scene mood and safely falls back", () => {
    expect(["BALANCED", "CLEAR_DAY", "GOLDEN_HOUR", "BLUE_HOUR", "NEON_NIGHT"].map(animeLookId))
      .toEqual([0, 1, 2, 3, 4]);
    expect(animeLookId("unknown")).toBe(0);
  });
});

describe("cel value grouping", () => {
  it("classifies stable shadow, base, and highlight regions", () => {
    expect(celBandIndex(0.1, 0.34, 0.76)).toBe(0);
    expect(celBandIndex(0.34, 0.34, 0.76)).toBe(1);
    expect(celBandIndex(0.75, 0.34, 0.76)).toBe(1);
    expect(celBandIndex(0.76, 0.34, 0.76)).toBe(2);
  });

  it("orders crossed thresholds and clamps non-finite luminance", () => {
    expect(celBandIndex(0.5, 0.8, 0.2)).toBe(1);
    expect(celBandIndex(Number.NaN, 0.3, 0.7)).toBe(0);
  });
});

describe("XDoG ink response", () => {
  it("darkens monotonically as the difference drops below threshold", () => {
    const responses = [-0.1, -0.04, 0, 0.04].map((difference) =>
      xdogInkResponse(difference, 0, 24));
    expect(responses).toEqual([...responses].sort((left, right) => right - left));
    expect(responses[0]).toBeGreaterThan(0.9);
    expect(responses.at(-1)).toBeLessThan(0.25);
  });

  it("remains finite for hostile values", () => {
    expect(xdogInkResponse(Number.NaN, 0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("anime rim-light direction", () => {
  it("uses image-space clockwise degrees", () => {
    expect(rimDirection(0)).toEqual({ x: 1, y: 0 });
    expect(rimDirection(90).x).toBeCloseTo(0);
    expect(rimDirection(90).y).toBeCloseTo(1);
    expect(rimDirection(Number.NaN)).toEqual({ x: 1, y: 0 });
  });
});

const animeFamily = [
  ["Anime Color Grade", "Color"],
  ["Anime Ink Lines", "Color"],
  ["Anime Sky", "Color"],
  ["Anime Tone Bands", "Color"],
  ["Anime Rim Light", "Stylize"],
] as const;

describe("anime production filter family", () => {
  it.each(animeFamily)("registers %s with complete control descriptions", (name, category) => {
    const entry = filterList.find((candidate) => candidate.displayName === name);
    expect(entry?.category).toBe(category);
    expect(filterIndex[name]).toBe(entry?.filter);
    expect(entry?.description).toBeTruthy();
    for (const [optionName, option] of Object.entries(entry?.filter.optionTypes ?? {})) {
      expect(option.desc, `${name}.${optionName}`).toBeTruthy();
    }
  });

  it("uses production-oriented defaults and keeps the new compositor GPU-only", () => {
    expect(filterIndex["Anime Color Grade"].optionTypes?.look).toBeDefined();
    expect(filterIndex["Anime Tone Bands"].optionTypes?.structureScale).toBeDefined();
    expect(filterIndex["Anime Ink Lines"].options?.source).toBe("XDOG");
    expect(filterIndex["Anime Sky"].optionTypes?.cloudScale).toBeDefined();
    expect(filterIndex["Anime Rim Light"].requiresGL).toBe(true);
  });
});
