import { describe, expect, it } from "vitest";
import { buildFilterSearchIndex, normalizeFilterSearchText, searchFilterIndex } from "components/filterSearch";

const entries = [
  {
    displayName: "Black Hole Lens",
    category: "Simulate",
    description: "Bend source-image rays around an event horizon",
    keywords: "gpu gl ray tracing",
  },
  {
    displayName: "Heightfield Raymarch",
    category: "Advanced",
    description: "Ray-march image luminance as deep relief",
    keywords: "gpu gl 3d",
  },
  {
    displayName: "Film Grain",
    category: "Stylize",
    description: "Organic photographic texture",
    keywords: "analog cinema",
  },
  {
    displayName: "Film Burn",
    category: "Glitch",
    description: "Overexposed projector damage",
    keywords: "animated temporal",
  },
];

const index = buildFilterSearchIndex(entries);

describe("filter typeahead search", () => {
  it("normalizes punctuation, casing, and diacritics", () => {
    expect(normalizeFilterSearchText("  Möbius / RAY-March  ")).toBe("mobius ray march");
  });

  it("ranks exact and name-prefix matches ahead of descriptive matches", () => {
    const result = searchFilterIndex(index, "film", 10);
    expect(result.items.map((entry) => entry.displayName)).toEqual([
      "Film Burn",
      "Film Grain",
    ]);
  });

  it("matches every token across names, categories, descriptions, and keywords", () => {
    expect(searchFilterIndex(index, "gpu horizon", 10).items[0]?.displayName).toBe("Black Hole Lens");
    expect(searchFilterIndex(index, "glitch projector", 10).items[0]?.displayName).toBe("Film Burn");
  });

  it("handles common typeahead suffixes", () => {
    expect(searchFilterIndex(index, "raymarching", 10).items[0]?.displayName).toBe("Heightfield Raymarch");
    expect(searchFilterIndex(index, "tracing", 10).items[0]?.displayName).toBe("Black Hole Lens");
  });

  it("reports the full match count while bounding rendered results", () => {
    const result = searchFilterIndex(index, "film", 1);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
  });
});
