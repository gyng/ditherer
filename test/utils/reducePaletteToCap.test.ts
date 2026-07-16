import { describe, expect, it } from "vitest";

import { reducePaletteToCap } from "utils";

// Guards the bug class this helper exists for: a palette larger than a shader's
// uniform array used to be `slice(0, cap)`d, silently rendering with whatever
// colors happened to be listed first. See docs/plan/055-n-candidate-dithering.md.

const greyRamp = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const v = Math.round((i / (n - 1)) * 255);
    return [v, v, v, 255];
  });

describe("reducePaletteToCap", () => {
  it("returns an under-cap palette untouched", () => {
    const small = [[0, 0, 0, 255], [255, 255, 255, 255]];
    expect(reducePaletteToCap(small, 64)).toBe(small);
  });

  it("returns an exactly-at-cap palette untouched", () => {
    const exact = greyRamp(64);
    expect(reducePaletteToCap(exact, 64)).toBe(exact);
  });

  it("reduces an over-cap palette to at most the cap", () => {
    expect(reducePaletteToCap(greyRamp(512), 256).length).toBeLessThanOrEqual(256);
    expect(reducePaletteToCap(greyRamp(200), 64).length).toBeLessThanOrEqual(64);
  });

  it("keeps the full tonal range instead of the first N colors", () => {
    // The actual bug: slice(0, 64) on a dark-to-light ramp keeps only the dark
    // end, so the image renders far too dark. Reduction must span the range.
    const got = reducePaletteToCap(greyRamp(256), 64);
    expect(Math.min(...got.map((c) => c[0]))).toBeLessThan(32);
    expect(Math.max(...got.map((c) => c[0]))).toBeGreaterThan(220);
  });

  it("only emits colors that were in the source palette", () => {
    // adaptMode MID picks a real bucket member — averaging would invent colors
    // the user never chose, which a palette-constrained filter must never do.
    const src = Array.from({ length: 300 }, (_, i) => [i % 256, (i * 5) % 256, (i * 11) % 256, 255]);
    const allowed = new Set(src.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (const c of reducePaletteToCap(src, 64)) {
      expect(allowed.has(`${c[0]},${c[1]},${c[2]}`)).toBe(true);
    }
  });

  it("does not return duplicates", () => {
    const dupes = Array.from({ length: 400 }, (_, i) => [(i % 16) * 16, (i % 5) * 60, 0, 255]);
    const got = reducePaletteToCap(dupes, 64);
    const keys = got.map((c) => `${c[0]},${c[1]},${c[2]}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays under a non-power-of-two cap", () => {
    // Depth is floored, so 96 yields at most 64 rather than overshooting to 128
    // and overflowing the uniform array it was sized for.
    expect(reducePaletteToCap(greyRamp(300), 96).length).toBeLessThanOrEqual(96);
  });

  it("preserves alpha, defaulting missing alpha to opaque", () => {
    const noAlpha = Array.from({ length: 200 }, (_, i) => [i, i, i]);
    for (const c of reducePaletteToCap(noAlpha, 64)) expect(c[3]).toBe(255);
  });
});
