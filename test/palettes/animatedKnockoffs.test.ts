import { describe, expect, it } from "vitest";

import { THEMES, THEME_CATEGORIES } from "palettes/user";

describe("Animated Knockoffs theme category", () => {
  it("exposes only wired, non-empty palette presets", () => {
    const entries = THEME_CATEGORIES["Animated Knockoffs"];

    expect(entries).toBeDefined();
    expect(entries.length).toBeGreaterThan(0);

    entries.forEach(({ key }) => {
      expect(THEMES[key], `missing theme for ${key}`).toBeDefined();
      expect(Array.isArray(THEMES[key]), `theme ${key} should be an array`).toBe(true);
      expect(THEMES[key].length, `theme ${key} should not be empty`).toBeGreaterThan(0);
    });
  });

  it("keeps the imported animated palette families at seven swatches each", () => {
    const entries = THEME_CATEGORIES["Animated Knockoffs"];

    entries.forEach(({ key }) => {
      expect(THEMES[key]).toHaveLength(7);
    });
  });
});
