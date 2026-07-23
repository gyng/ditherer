import { describe, expect, it } from "vitest";
import { claheCdfAtlasLayout } from "../../packages/ditherer-filters/src/filters/claheGL";

describe("core tone and edge quality contracts", () => {
  it("packs an HD 8-pixel CLAHE grid within ordinary WebGL texture limits", () => {
    const tiles = Math.ceil(1920 / 8) * Math.ceil(1080 / 8);
    const layout = claheCdfAtlasLayout(tiles, 16_384);
    expect(layout).not.toBeNull();
    expect(layout?.width).toBeLessThanOrEqual(16_384);
    expect(layout?.height).toBeLessThanOrEqual(16_384);
    expect((layout?.tilesPerRow ?? 0) * (layout?.height ?? 0)).toBeGreaterThanOrEqual(tiles);
  });

  it("rejects a CDF atlas only when the device cannot contain it", () => {
    expect(claheCdfAtlasLayout(1, 255)).toBeNull();
    expect(claheCdfAtlasLayout(70_000, 4096)).toBeNull();
    expect(claheCdfAtlasLayout(4096, 4096)).toEqual({ width: 4096, height: 256, tilesPerRow: 16 });
  });
});
