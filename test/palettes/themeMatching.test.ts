import { describe, expect, it } from "vitest";

import { THEMES, findMatchingThemeKey, getThemeDescription } from "palettes/user";

describe("theme matching", () => {
  it("matches built-in themes by color content instead of array identity", () => {
    const cloned = THEMES.BATHHOUSE_TRAINRIDE.map((color) => [...color]);

    expect(cloned).not.toBe(THEMES.BATHHOUSE_TRAINRIDE);
    expect(findMatchingThemeKey(cloned)).toBe("BATHHOUSE_TRAINRIDE");
  });

  it("returns null for custom palettes with no exact theme match", () => {
    expect(findMatchingThemeKey([[1, 2, 3, 255], [4, 5, 6, 255]])).toBe(null);
  });

  it("can look up the matching theme description", () => {
    expect(getThemeDescription("BATHHOUSE_TRAINRIDE")).toContain("Dream commute at dusk");
  });
});
