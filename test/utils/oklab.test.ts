import { describe, expect, it } from "vitest";

import { colorDistance, rgba2oklaba, rgba2laba } from "utils";
import { OKLAB_NEAREST } from "constants/color";

// OKLab (Björn Ottosson, https://bottosson.github.io/posts/oklab/).
//
// These assert against values published outside this repo rather than against
// whatever the implementation happens to emit — a conversion that agrees only
// with itself is a snapshot, not a check. The sRGB primaries below are the
// widely-cited reference values for this transform.

describe("rgba2oklaba matches Ottosson's published values", () => {
  const cases: [string, number[], [number, number, number]][] = [
    ["white", [255, 255, 255, 255], [1.0, 0.0, 0.0]],
    ["black", [0, 0, 0, 255], [0.0, 0.0, 0.0]],
    ["red", [255, 0, 0, 255], [0.6279, 0.2249, 0.1258]],
    ["green", [0, 255, 0, 255], [0.8664, -0.2339, 0.1795]],
    ["blue", [0, 0, 255, 255], [0.452, -0.0324, -0.3115]],
  ];

  it.each(cases)("%s", (_name, rgb, want) => {
    const got = rgba2oklaba(rgb);
    expect(got[0]).toBeCloseTo(want[0], 3);
    expect(got[1]).toBeCloseTo(want[1], 3);
    expect(got[2]).toBeCloseTo(want[2], 3);
  });

  it("carries alpha through untouched, like the other converters", () => {
    expect(rgba2oklaba([10, 20, 30, 123])[3]).toBe(123);
  });

  it("is achromatic for greys — a == b == 0", () => {
    // Any neutral must land on the L axis. A sign error in the LMS matrix
    // shows up here even when the primaries above still look plausible.
    for (const v of [0, 64, 128, 200, 255]) {
      const [, a, b] = rgba2oklaba([v, v, v, 255]);
      expect(Math.abs(a)).toBeLessThan(1e-6);
      expect(Math.abs(b)).toBeLessThan(1e-6);
    }
  });

  it("L increases monotonically with grey level", () => {
    let prev = -1;
    for (let v = 0; v <= 255; v += 5) {
      const L = rgba2oklaba([v, v, v, 255])[0];
      expect(L).toBeGreaterThan(prev);
      prev = L;
    }
  });
});

describe("OKLab ranges differ from Lab, and callers must not assume otherwise", () => {
  it("L is 0..1, where Lab's is 0..100", () => {
    // The single most likely integration bug: reusing a Lab-tuned threshold.
    expect(rgba2oklaba([255, 255, 255, 255])[0]).toBeCloseTo(1, 6);
    expect(rgba2laba([255, 255, 255, 255])[0]).toBeCloseTo(100, 4);
  });

  it("a/b stay well inside +-0.4 across the whole cube", () => {
    let maxAb = 0;
    for (let r = 0; r < 256; r += 15)
      for (let g = 0; g < 256; g += 15)
        for (let b = 0; b < 256; b += 15) {
          const ok = rgba2oklaba([r, g, b, 255]);
          maxAb = Math.max(maxAb, Math.abs(ok[1]), Math.abs(ok[2]));
        }
    expect(maxAb).toBeLessThan(0.4);
    expect(maxAb).toBeGreaterThan(0.2); // and it's not collapsed to ~0
  });
});

describe("OKLAB_NEAREST distance", () => {
  it("is zero for identical colours", () => {
    expect(colorDistance([12, 34, 56, 255], [12, 34, 56, 255], OKLAB_NEAREST)).toBe(0);
  });

  it("is symmetric", () => {
    const a = colorDistance([10, 200, 30, 255], [240, 20, 90, 255], OKLAB_NEAREST);
    const b = colorDistance([240, 20, 90, 255], [10, 200, 30, 255], OKLAB_NEAREST);
    expect(a).toBeCloseTo(b, 12);
  });

  it("ranks a near colour below a far one", () => {
    const near = colorDistance([100, 100, 100, 255], [105, 100, 100, 255], OKLAB_NEAREST);
    const far = colorDistance([100, 100, 100, 255], [255, 0, 0, 255], OKLAB_NEAREST);
    expect(near).toBeLessThan(far);
  });

  it("ignores alpha, like every other algorithm here", () => {
    // The whole-buffer quantizers rely on this: they score RGB and copy source
    // alpha through. If OKLab started weighing alpha they would diverge.
    const opaque = colorDistance([10, 20, 30, 255], [40, 50, 60, 255], OKLAB_NEAREST);
    const alpha = colorDistance([10, 20, 30, 0], [40, 50, 60, 200], OKLAB_NEAREST);
    expect(opaque).toBeCloseTo(alpha, 12);
  });

  it("black is closer to dark grey than to white", () => {
    const toDark = colorDistance([0, 0, 0, 255], [40, 40, 40, 255], OKLAB_NEAREST);
    const toWhite = colorDistance([0, 0, 0, 255], [255, 255, 255, 255], OKLAB_NEAREST);
    expect(toDark).toBeLessThan(toWhite);
  });
});
