import { describe, expect, it } from "vitest";
import { buildFilterSearchIndex, searchFilterIndex } from "components/filterSearch";

const entries = [
  { displayName: "Film Grain", category: "Photo", description: "Organic silver texture", keywords: "analog noise" },
  { displayName: "Glitch Blocks", category: "Digital Errors", description: "Broken compression", keywords: "datamosh" },
  { displayName: "Painterly Smear", category: "Artistic", description: "Painted brush strokes", keywords: "canvas" },
  { displayName: "Boxes", category: "Geometry", description: "Squared tiles", keywords: "grid" },
  { displayName: "Color Bands", category: "Color", description: "Poster colors", keywords: "palette" },
  { displayName: "Grain Film", category: "Photo", description: "Ordering candidate", keywords: "analog" },
];

describe("filter search decision boundaries", () => {
  const index = buildFilterSearchIndex(entries);

  it("indexes absent optional text as empty searchable fields", () => {
    expect(buildFilterSearchIndex([{ displayName: "Bare", category: "Other" }])[0])
      .toMatchObject({ description: "", keywords: "", nameWords: ["bare"], categoryWords: ["other"] });
  });

  it("orders exact names, name prefixes, name substrings, and category matches", () => {
    expect(searchFilterIndex(index, "film grain").items[0].displayName).toBe("Film Grain");
    expect(searchFilterIndex(index, "film").items.map((entry) => entry.displayName))
      .toEqual(["Film Grain", "Grain Film"]);
    expect(searchFilterIndex(index, "grain").items.map((entry) => entry.displayName))
      .toEqual(["Grain Film", "Film Grain"]);
    expect(searchFilterIndex(index, "photo").total).toBe(2);
  });

  it("matches word/category prefixes, category substrings, keywords, and descriptions", () => {
    expect(searchFilterIndex(index, "glit").items[0].displayName).toBe("Glitch Blocks");
    expect(searchFilterIndex(index, "error").items[0].displayName).toBe("Glitch Blocks");
    expect(searchFilterIndex(index, "igit").items[0].displayName).toBe("Glitch Blocks");
    expect(searchFilterIndex(index, "datamosh").items[0].displayName).toBe("Glitch Blocks");
    expect(searchFilterIndex(index, "silver").items[0].displayName).toBe("Film Grain");
  });

  it("accepts ed/es/s inflections while requiring every query token", () => {
    expect(searchFilterIndex(index, "painted").items[0].displayName).toBe("Painterly Smear");
    expect(searchFilterIndex(index, "boxes").items[0].displayName).toBe("Boxes");
    expect(searchFilterIndex(index, "colors").items[0].displayName).toBe("Color Bands");
    expect(searchFilterIndex(index, "film impossible")).toEqual({ items: [], total: 0 });
  });

  it("preserves totals when limits are zero or negative and rejects empty queries", () => {
    expect(searchFilterIndex(index, "film", 0)).toMatchObject({ total: 2, items: [] });
    expect(searchFilterIndex(index, "film", -1)).toMatchObject({ total: 2, items: [] });
    expect(searchFilterIndex(index, "   ")).toEqual({ items: [], total: 0 });
  });
});
