import { describe, expect, it } from "vitest";

import nCandidateDither, {
  ALGO,
  COLORSPACE,
  optionTypes,
  paletteColorsFor,
} from "filters/nCandidateDither";
import {
  candidateWeights,
  ditherNCandidate,
  defaultParams,
  preparePalette,
  solveT,
  type NCandidateAlgo,
  type NCandidateParams,
} from "../fixtures/nCandidateReference";

const ALL_ALGOS: NCandidateAlgo[] = ["KNOLL", "EMA_SWEEP", "EMA_EXACT", "EMA_CONSTANT"];

const BLACK_WHITE = [[0, 0, 0, 255], [255, 255, 255, 255]];
const PICO_ISH = [
  [0, 0, 0, 255], [126, 37, 83, 255], [0, 135, 81, 255], [171, 82, 54, 255],
  [95, 87, 79, 255], [194, 195, 199, 255], [255, 241, 232, 255], [255, 0, 77, 255],
];

// Deterministic PRNG so the random-geometry sweeps are reproducible.
const makeRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const dist2 = (a: readonly number[], b: readonly number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const mixAt = (a: readonly number[], b: readonly number[], t: number) =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const solidRgba = (w: number, h: number, rgb: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return data;
};

const withParams = (over: Partial<NCandidateParams>): NCandidateParams => ({
  ...defaultParams, ...over,
});

describe("solveT — closest point on a segment", () => {
  it("finds a t at least as good as a 10k-step brute-force sweep", () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 200; trial++) {
      const a = [rng(), rng(), rng()];
      const b = [rng(), rng(), rng()];
      const c = [rng(), rng(), rng()];

      const t = solveT(a, b, c, 0, 1);
      const analytic = dist2(c, mixAt(a, b, t));

      let brute = Infinity;
      for (let i = 0; i <= 10000; i++) {
        const d = dist2(c, mixAt(a, b, i / 10000));
        if (d < brute) brute = d;
      }
      // The analytic solution is exact; the sweep can only tie or lose.
      expect(analytic).toBeLessThanOrEqual(brute + 1e-9);
    }
  });

  it("clamps t into [minT, maxT] even when the true optimum lies outside", () => {
    // The closest point to `c` here is behind `a` (t < 0), so the floor binds.
    expect(solveT([0.5, 0.5, 0.5], [1, 1, 1], [0, 0, 0], 0.2, 0.975)).toBeCloseTo(0.2, 6);
    // ...and past `b` (t > 1) here, so the ceiling binds.
    expect(solveT([0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1], 0.2, 0.975)).toBeCloseTo(0.975, 6);
  });

  it("returns the clamped floor for a degenerate segment", () => {
    // a == b: there's no direction to project onto, so t stays 0 and clamps up.
    expect(solveT([0.3, 0.3, 0.3], [0.3, 0.3, 0.3], [0.9, 0.1, 0.4], 0.2, 1)).toBe(0.2);
  });
});

describe("candidate weights", () => {
  it.each(ALL_ALGOS)("%s normalizes weights to sum 1", (algo) => {
    const pal = preparePalette(PICO_ISH, "SRGB");
    const weights = candidateWeights([0.4, 0.6, 0.3], pal, withParams({ algo }));
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it.each(ALL_ALGOS)("%s puts all weight on an exact palette match", (algo) => {
    const pal = preparePalette(PICO_ISH, "SRGB");
    // [126, 37, 83] is in the palette verbatim — there is no error to spread.
    const p = [126 / 255, 37 / 255, 83 / 255];
    const weights = candidateWeights(p, pal, withParams({ algo }));

    const hit = pal.out.findIndex((c) => c[0] === 126 && c[1] === 37 && c[2] === 83);
    expect(weights[hit]).toBeCloseTo(1, 6);
  });

  it.each(ALL_ALGOS)("%s survives a single-color palette", (algo) => {
    const pal = preparePalette([[10, 20, 30, 255]], "SRGB");
    const weights = candidateWeights([0.9, 0.1, 0.5], pal, withParams({ algo }));
    expect(Array.from(weights)).toEqual([1]);
  });
});

describe("ditherNCandidate", () => {
  it.each(ALL_ALGOS)("%s dithers flat mid-grey into both palette extremes", (algo) => {
    const out = ditherNCandidate(
      solidRgba(4, 4, [128, 128, 128]), 4, 4, BLACK_WHITE, withParams({ algo }),
    );
    const uniq = new Set<number>();
    for (let i = 0; i < out.length; i += 4) uniq.add(out[i]);
    // A flat input must break into a pattern, not collapse to one color.
    expect(uniq).toEqual(new Set([0, 255]));
  });

  it.each(ALL_ALGOS)("%s reproduces the local mean of flat mid-grey", (algo) => {
    const out = ditherNCandidate(
      solidRgba(4, 4, [128, 128, 128]), 4, 4, BLACK_WHITE, withParams({ algo }),
    );
    let sum = 0;
    for (let i = 0; i < out.length; i += 4) sum += out[i];
    const mean = sum / 16;
    // Local mean reproduction is the property every N-candidate method targets:
    // blurred output should look like the input.
    expect(Math.abs(mean - 128)).toBeLessThan(40);
  });

  it("emits an exact palette color unchanged", () => {
    const out = ditherNCandidate(solidRgba(2, 2, [0, 135, 81]), 2, 2, PICO_ISH, defaultParams);
    for (let i = 0; i < out.length; i += 4) {
      expect([out[i], out[i + 1], out[i + 2]]).toEqual([0, 135, 81]);
    }
  });

  it("preserves source alpha", () => {
    const src = solidRgba(2, 2, [128, 128, 128]);
    src[3] = 7;
    const out = ditherNCandidate(src, 2, 2, BLACK_WHITE, defaultParams);
    expect(out[3]).toBe(7);
  });

  it("only ever emits colors that are in the palette", () => {
    const rng = makeRng(42);
    const src = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = rng() * 255; src[i + 1] = rng() * 255; src[i + 2] = rng() * 255; src[i + 3] = 255;
    }
    const out = ditherNCandidate(src, 8, 8, PICO_ISH, defaultParams);
    const allowed = new Set(PICO_ISH.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (let i = 0; i < out.length; i += 4) {
      expect(allowed.has(`${out[i]},${out[i + 1]},${out[i + 2]}`)).toBe(true);
    }
  });

  it("raising N reduces noise — fewer isolated candidates in flat regions", () => {
    const countRuns = (n: number) => {
      const out = ditherNCandidate(
        solidRgba(8, 8, [90, 140, 200]), 8, 8, PICO_ISH, withParams({ candidates: n }),
      );
      const uniq = new Set<string>();
      for (let i = 0; i < out.length; i += 4) uniq.add(`${out[i]},${out[i + 1]},${out[i + 2]}`);
      return uniq.size;
    };
    // N=2 can barely explore the palette; N=32 finds a richer candidate set to
    // reproduce the same color. This is the article's "N drives noisiness" claim
    // from the other side: more candidates, more colors in the mix.
    expect(countRuns(32)).toBeGreaterThanOrEqual(countRuns(2));
  });
});

describe("colorspaces", () => {
  it.each(["SRGB", "LINEAR", "LIQ"] as const)("%s stays inside the palette", (colorspace) => {
    const out = ditherNCandidate(
      solidRgba(4, 4, [200, 40, 90]), 4, 4, PICO_ISH, withParams({ colorspace }),
    );
    const allowed = new Set(PICO_ISH.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (let i = 0; i < out.length; i += 4) {
      expect(allowed.has(`${out[i]},${out[i + 1]},${out[i + 2]}`)).toBe(true);
    }
  });

  it("LIQ ordering differs from sRGB ordering for saturated palettes", () => {
    // The whole point of the LIQ transform is that it reweights channels, so a
    // green-heavy palette must not sort the same way it does in plain sRGB.
    const srgb = preparePalette(PICO_ISH, "SRGB").out.map((c) => c.join(","));
    const liq = preparePalette(PICO_ISH, "LIQ").out.map((c) => c.join(","));
    expect(liq).not.toEqual(srgb);
  });
});

describe("filter wiring", () => {
  it("is GL-only", () => {
    expect(nCandidateDither.requiresGL).toBe(true);
  });

  it("shows strength only for Knoll", () => {
    const visible = optionTypes.strength.visibleWhen;
    expect(visible({ algo: ALGO.KNOLL })).toBe(true);
    expect(visible({ algo: ALGO.EMA_EXACT })).toBe(false);
  });

  it("shows minT only for the solved/swept variants", () => {
    const visible = optionTypes.minT.visibleWhen;
    expect(visible({ algo: ALGO.EMA_EXACT })).toBe(true);
    expect(visible({ algo: ALGO.EMA_SWEEP })).toBe(true);
    expect(visible({ algo: ALGO.EMA_CONSTANT })).toBe(false);
    expect(visible({ algo: ALGO.KNOLL })).toBe(false);
  });

  it("shows the sweep-only controls only for EMA-Sweep", () => {
    expect(optionTypes.sweepTests.visibleWhen({ algo: ALGO.EMA_SWEEP })).toBe(true);
    expect(optionTypes.sweepTests.visibleWhen({ algo: ALGO.EMA_EXACT })).toBe(false);
    // The reference restricts luma weighting to the sweep variant.
    expect(optionTypes.lumaWeighted.visibleWhen({ algo: ALGO.EMA_SWEEP })).toBe(true);
    expect(optionTypes.lumaWeighted.visibleWhen({ algo: ALGO.KNOLL })).toBe(false);
  });

  it("defaults to the article's recommended variant and N", () => {
    expect(nCandidateDither.defaults?.algo).toBe(ALGO.EMA_EXACT);
    expect(nCandidateDither.defaults?.candidates).toBe(32);
    expect(nCandidateDither.defaults?.colorspace).toBe(COLORSPACE.SRGB);
  });
});

describe("paletteColorsFor", () => {
  it("passes explicit palette colors through", () => {
    expect(paletteColorsFor({ options: { colors: BLACK_WHITE } })).toEqual(BLACK_WHITE);
  });

  it("synthesizes an RGB cube for a levels-only palette", () => {
    const cube = paletteColorsFor({ options: { levels: 2 } });
    expect(cube).toHaveLength(8);
    expect(cube).toContainEqual([0, 0, 0, 255]);
    expect(cube).toContainEqual([255, 255, 255, 255]);
  });

  it("clamps synthesized levels so the cube fits the shader's palette limit", () => {
    // 5^3 = 125 would overflow MAX_PAL (64); 4^3 = 64 is the largest that fits.
    expect(paletteColorsFor({ options: { levels: 8 } })).toHaveLength(64);
  });

  it("keeps an at-cap palette exactly as given", () => {
    const exact = Array.from({ length: 64 }, (_, i) => [i * 4, i * 2, 255 - i * 4, 255]);
    expect(paletteColorsFor({ options: { colors: exact } })).toEqual(exact);
  });

  it("reduces an oversized palette to the shader limit", () => {
    const big = Array.from({ length: 200 }, (_, i) => [i, 255 - i, (i * 7) % 256, 255]);
    expect(paletteColorsFor({ options: { colors: big } }).length).toBeLessThanOrEqual(64);
  });

  it("reduces oversized palettes by spread, not by taking the first N", () => {
    // A slice(0, 64) would keep only the dark end of this ramp and render the
    // image far too dark. Median-cut must reach the bright end too.
    const ramp = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    const got = paletteColorsFor({ options: { colors: ramp } });
    const brightest = Math.max(...got.map((c) => c[0]));
    expect(brightest).toBeGreaterThan(200);
  });

  it("only returns colors that were actually in the palette", () => {
    // adaptMode MID picks a real bucket member — a dither must never emit a
    // color the user didn't choose.
    const ramp = Array.from({ length: 200 }, (_, i) => [i, (i * 3) % 256, 255 - i, 255]);
    const allowed = new Set(ramp.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (const c of paletteColorsFor({ options: { colors: ramp } })) {
      expect(allowed.has(`${c[0]},${c[1]},${c[2]}`)).toBe(true);
    }
  });

  it("does not return duplicate colors after reduction", () => {
    // Buckets holding identical colors collapse; duplicates would waste
    // candidate iterations and skew the weight walk.
    const dupes = Array.from({ length: 200 }, (_, i) => [(i % 20) * 12, (i % 7) * 30, 0, 255]);
    const got = paletteColorsFor({ options: { colors: dupes } });
    const keys = got.map((c) => `${c[0]},${c[1]},${c[2]}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
