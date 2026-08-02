import { describe, expect, it } from "vitest";

import {
  ALTERNATE_3X3,
  BAYER_16X16,
  BAYER_16X16_T,
  BAYER_2X2,
  BAYER_2X2_T,
  BAYER_3X3,
  BAYER_4X4,
  BAYER_4X4_T,
  BAYER_8X8,
  BAYER_8X8_T,
  BLOCK_HORIZONTAL_4X4,
  BLOCK_VERTICAL_4X4,
  BLUE_NOISE_16X16,
  BLUE_NOISE_64X64,
  CORNER_4X4,
  DISPERSED_DOT_3X3,
  HATCH_2X2,
  HATCH_3X3,
  HATCH_4X4,
  PATTERN_5X5,
  SQUARE_5X5,
  THRESHOLD_POLARITY,
  WHITE_NOISE_64X64,
  getOrderedThresholdMapPreview,
} from "filters/ordered";

// Ordered is requiresGL, so its real output can only be seen in a browser — but
// the threshold maps are plain data and the shader is a faithful lookup into
// them. Pinning the tables here catches the bugs that matter (a transposed or
// permuted map) without a GPU, and covers all 18 rather than the two that had
// any assertion before (BAYER_2X2's polarity, WHITE_NOISE's distribution).
//
// A transposed BAYER_8X8 currently passes everything: gl-smoke still sees alpha
// and luma, and the one real output check uses the default map and only asserts
// levels=2 gives {0,255}, which any non-constant threshold satisfies. Users see
// a diagonal-biased pattern.

// The standard recurrence — this is the *definition* of a Bayer matrix:
//   M(1)  = [[0]]
//   M(2n) = [[4*M(n),   4*M(n)+2],
//            [4*M(n)+3, 4*M(n)+1]]
// Deriving it here means the checked-in tables are compared against the maths
// rather than against themselves.
const bayer = (n: number): number[][] => {
  if (n === 1) return [[0]];
  const half = bayer(n / 2);
  const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < n / 2; y++) {
    for (let x = 0; x < n / 2; x++) {
      const v = half[y][x] * 4;
      out[y][x] = v;
      out[y][x + n / 2] = v + 2;
      out[y + n / 2][x] = v + 3;
      out[y + n / 2][x + n / 2] = v + 1;
    }
  }
  return out;
};

// The filter stores maps pre-scaled to [0,1); undo that to compare against the
// integer recurrence.
const asIntegers = (map: number[][], levels: number) =>
  map.map((row) => row.map((v) => Math.round((v ?? 0) * levels)));

const preview = (key: string, polarity = THRESHOLD_POLARITY.SHADOW) =>
  getOrderedThresholdMapPreview(key, polarity);

const transpose = (m: number[][]) => m.map((_, y) => m.map((row) => row[y]));

describe("Bayer maps match the recurrence", () => {
  // NOTE — the checked-in tables are not consistently oriented:
  //
  //   BAYER_2X2 / BAYER_4X4  ==  recurrence
  //   BAYER_8X8 / BAYER_16X16 == transpose(recurrence)
  //
  // All four are valid Bayer matrices (each is a clean permutation of
  // 0..n^2-1, verified below), so this is cosmetic rather than a correctness
  // bug — the dither texture's diagonal mirrors when you switch map size.
  // Normalising the orientation would change the output of every saved chain
  // using 8x8 or 16x16, so the tables are left alone and pinned as they are.
  // Each is still asserted exactly, so an accidental transpose in either
  // direction fails.
  it.each([
    [BAYER_2X2, 2, false],
    [BAYER_4X4, 4, false],
    [BAYER_8X8, 8, true],
    [BAYER_16X16, 16, true],
  ])("%s is exactly the generated %ix%i matrix", (key, n, transposed) => {
    const { thresholdMap } = preview(key);
    const expected = transposed ? transpose(bayer(n)) : bayer(n);
    expect(asIntegers(thresholdMap, n * n)).toEqual(expected);
  });

  it("distinguishes a matrix from its transpose", () => {
    // Guard the guard: if a Bayer matrix equalled its own transpose, the
    // assertions above would be satisfied by either orientation and prove
    // nothing about which one is checked in.
    expect(transpose(bayer(4))).not.toEqual(bayer(4));
    expect(transpose(bayer(8))).not.toEqual(bayer(8));
  });
});

describe("transposed Bayer variants", () => {
  // The tables are inconsistently oriented (see above), so both orientations are
  // offered rather than renormalising and changing existing chains. Each variant
  // is derived from its sibling in the source, so what's worth pinning is that
  // the pair really is a transpose — and that the variant is still a valid Bayer
  // matrix rather than, say, a rotation or a mirror.
  it.each([
    [BAYER_2X2, BAYER_2X2_T, 2],
    [BAYER_4X4, BAYER_4X4_T, 4],
    [BAYER_8X8, BAYER_8X8_T, 8],
    [BAYER_16X16, BAYER_16X16_T, 16],
  ])("%s and %s are transposes of each other", (base, variant, n) => {
    const b = asIntegers(preview(base).thresholdMap, n * n);
    const v = asIntegers(preview(variant).thresholdMap, n * n);
    expect(v).toEqual(transpose(b));
    // ...and not simply a copy, which is what a broken derivation would give.
    expect(v).not.toEqual(b);
  });

  it.each([
    [BAYER_2X2_T, 2],
    [BAYER_4X4_T, 4],
    [BAYER_8X8_T, 8],
    [BAYER_16X16_T, 16],
  ])("%s is still a valid Bayer matrix", (key, n) => {
    // A transpose permutes cells, so every level must survive exactly once.
    const values = asIntegers(preview(key).thresholdMap, n * n)
      .flat()
      .sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: n * n }, (_, i) => i));
  });

  it("gives both orientations of each size across the pair", () => {
    // The point of the variants: whichever way a checked-in table leans, the
    // other lean is now reachable. So for every size, one of the pair matches
    // the canonical recurrence and the other matches its transpose.
    for (const [base, variant, n] of [
      [BAYER_2X2, BAYER_2X2_T, 2],
      [BAYER_4X4, BAYER_4X4_T, 4],
      [BAYER_8X8, BAYER_8X8_T, 8],
      [BAYER_16X16, BAYER_16X16_T, 16],
    ] as const) {
      const canonical = bayer(n);
      const maps = [
        asIntegers(preview(base).thresholdMap, n * n),
        asIntegers(preview(variant).thresholdMap, n * n),
      ];
      expect(maps, `size ${n}: neither orientation is the recurrence`).toContainEqual(canonical);
      expect(maps, `size ${n}: neither orientation is the transposed recurrence`).toContainEqual(
        transpose(canonical),
      );
    }
  });
});

describe("every threshold map is well formed", () => {
  const ALL = [
    BAYER_2X2,
    BAYER_3X3,
    BAYER_4X4,
    BAYER_8X8,
    BAYER_16X16,
    SQUARE_5X5,
    CORNER_4X4,
    BLOCK_VERTICAL_4X4,
    BLOCK_HORIZONTAL_4X4,
    HATCH_2X2,
    HATCH_3X3,
    HATCH_4X4,
    ALTERNATE_3X3,
    DISPERSED_DOT_3X3,
    PATTERN_5X5,
    BLUE_NOISE_16X16,
    BLUE_NOISE_64X64,
    WHITE_NOISE_64X64,
    BAYER_2X2_T,
    BAYER_4X4_T,
    BAYER_8X8_T,
    BAYER_16X16_T,
  ];

  it.each(ALL)("%s stays within [0,1) and is rectangular", (key) => {
    const { thresholdMap } = preview(key);
    const width = thresholdMap[0].length;
    for (const row of thresholdMap) {
      expect(row).toHaveLength(width);
      for (const v of row) {
        // A value >= 1 can never be crossed by a cumulative weight, so that cell
        // would be unreachable; < 0 would always fire.
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it.each(ALL)("%s inverts under CLASSIC polarity", (key) => {
    // Previously only checked for BAYER_2X2.
    const shadow = preview(key, THRESHOLD_POLARITY.SHADOW).thresholdMap;
    const classic = preview(key, THRESHOLD_POLARITY.CLASSIC).thresholdMap;
    for (let y = 0; y < shadow.length; y++) {
      for (let x = 0; x < shadow[y].length; x++) {
        expect(classic[y][x]).toBeCloseTo(1 - shadow[y][x], 10);
      }
    }
  });

  it.each([
    [BAYER_2X2, 4],
    [BAYER_3X3, 9],
    [BAYER_4X4, 16],
    [BAYER_8X8, 64],
    [BAYER_16X16, 256],
    [CORNER_4X4, 16],
    [DISPERSED_DOT_3X3, 9],
  ])("%s is a permutation of 0..%i-1 — no duplicate or missing level", (key, levels) => {
    // Dispersed-dot maps must use each level exactly once; a duplicate means two
    // cells fire together and the pattern loses a gradient step.
    const { thresholdMap } = preview(key);
    const values = asIntegers(thresholdMap, levels)
      .flat()
      .sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: levels }, (_, i) => i));
  });
});

describe("map metadata matches the data", () => {
  it.each([
    [BAYER_2X2, 2, 2],
    [BAYER_4X4, 4, 4],
    [BAYER_8X8, 8, 8],
    [BAYER_16X16, 16, 16],
    [BLUE_NOISE_64X64, 64, 64],
    [WHITE_NOISE_64X64, 64, 64],
    [SQUARE_5X5, 5, 5],
  ])("%s reports %ix%i", (key, w, h) => {
    // The shader tiles using the reported dimensions; if they disagree with the
    // table it samples the wrong cell.
    const p = preview(key);
    expect([p.width, p.height]).toEqual([w, h]);
    expect(p.thresholdMap[0]).toHaveLength(w);
    expect(p.thresholdMap).toHaveLength(h);
  });

  it("falls back to a real map for an unknown key rather than throwing", () => {
    const p = preview("NOT_A_MAP");
    expect(p.thresholdMap.length).toBeGreaterThan(0);
  });
});
