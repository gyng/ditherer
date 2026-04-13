import { describe, expect, it } from "vitest";
import {
  formatEta,
  getGifPaletteColorTable,
  normalizeGifFrames,
  quantizeGifDelay,
} from "components/SaveAs/helpers";

describe("getGifPaletteColorTable", () => {
  it("returns the first valid deduped palette candidate", () => {
    expect(getGifPaletteColorTable([
      null,
      { options: { colors: [] } },
      {
        options: {
          colors: [
            [0, 0, 0],
            [255, 255, 255],
            [255, 255, 255],
            [12.4, 260, -5],
          ],
        },
      },
    ])).toEqual([
      [0, 0, 0],
      [255, 255, 255],
      [12, 255, 0],
    ]);
  });

  it("returns null when no candidate exposes at least two colors", () => {
    expect(getGifPaletteColorTable([
      undefined,
      { options: { colors: [[12, 12, 12]] } },
      { options: { colors: "nope" } },
    ])).toBeNull();
  });
});

describe("normalizeGifFrames", () => {
  it("merges adjacent duplicate frames and quantizes delay", () => {
    const shared = new Uint8ClampedArray([1, 2, 3, 255]);
    const unique = new Uint8ClampedArray([4, 5, 6, 255]);

    expect(normalizeGifFrames([
      { data: shared, width: 1, height: 1, delay: 17 },
      { data: shared, width: 1, height: 1, delay: 21 },
      { data: unique, width: 1, height: 1, delay: 9 },
    ])).toEqual([
      { data: shared, width: 1, height: 1, delay: quantizeGifDelay(40) },
      { data: unique, width: 1, height: 1, delay: quantizeGifDelay(9) },
    ]);
  });
});

describe("formatEta", () => {
  it("formats seconds and minutes consistently", () => {
    expect(formatEta(4000)).toBe("4s");
    expect(formatEta(65_000)).toBe("1m 05s");
  });
});
