import { describe, expect, it } from "vitest";
import {
  areFrameBuffersEqual,
  canWriteClipboard,
  formatEta,
  formatTime,
  getGifPaletteColorTable,
  makeFilename,
  normalizeGifFrames,
  quantizeGifDelay,
  rgbToCss,
  toGifBuffer,
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

  it("clamps negative input to zero rather than emitting a weird -0s", () => {
    expect(formatEta(-1000)).toBe("0s");
  });
});

describe("formatTime", () => {
  it("zero-pads both minutes and seconds", () => {
    expect(formatTime(7)).toBe("00:07");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(3599)).toBe("59:59");
  });
});

describe("makeFilename", () => {
  it("builds a timestamped ditherer filename with the given extension", () => {
    const name = makeFilename("png");
    expect(name).toMatch(/^ditherer-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
  });
});

describe("rgbToCss", () => {
  it("formats a 3-channel tuple into a standard rgb(...) string", () => {
    expect(rgbToCss([10, 20, 30])).toBe("rgb(10, 20, 30)");
  });
});

describe("toGifBuffer", () => {
  it("returns a fresh Uint8Array sharing the same bytes as the clamped source", () => {
    const src = new Uint8ClampedArray([1, 2, 3, 4]);
    const out = toGifBuffer(src);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });
});

describe("areFrameBuffersEqual", () => {
  it("returns true for byte-identical buffers and false otherwise", () => {
    const a = new Uint8ClampedArray([1, 2, 3, 4]);
    const b = new Uint8ClampedArray([1, 2, 3, 4]);
    const c = new Uint8ClampedArray([1, 2, 3, 5]);
    const d = new Uint8ClampedArray([1, 2, 3]);
    expect(areFrameBuffersEqual(a, b)).toBe(true);
    expect(areFrameBuffersEqual(a, c)).toBe(false);
    expect(areFrameBuffersEqual(a, d)).toBe(false);
  });
});

describe("canWriteClipboard", () => {
  it("reflects the navigator.clipboard capability", () => {
    // jsdom exposes navigator; clipboard may or may not be present, but the
    // check should run without throwing.
    expect(typeof canWriteClipboard()).toBe("boolean");
  });
});
