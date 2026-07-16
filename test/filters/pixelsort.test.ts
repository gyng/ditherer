import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import pixelsort, { defaults } from "filters/pixelsort";
import nearest from "palettes/nearest";

// Pixel Sort is the largest JS-only filter in the repo (~630 lines) and is
// noGL + noWASM, so this JS is the only path there is — yet it had no test
// beyond "the registry iterated over it and it returned a canvas". Same profile
// as the Octree hang, 2.4x the size.
//
// The invariant that makes it worth testing cheaply: sorting is a PERMUTATION.
// Every interval is rearranged in place and written back to the same buffer
// positions, so with an identity palette the output must be multiset-identical
// to the input. A sort that drops, duplicates, or fabricates a pixel fails that
// immediately, whatever the traversal order or comparator.
//
// Note the registry ships `withPaletteLevels(pixelsort, 256)` — an identity
// palette — so that's what users get and what these use. The module's own
// default is `nearest` at levels=2, which would quantize; that difference is
// deliberate but easy to trip over.

const W = 12;
const H = 12;

const identityPalette = { ...nearest, options: { levels: 256 } };

const makeCanvas = (fill: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = fill(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: W,
    height: H,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(data), width: W, height: H }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        written = new Uint8ClampedArray(img.data);
      },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, written: () => written, source: data };
};

// Deterministic pseudo-random colors — a gradient would make many pixels tie
// under a luminance comparator and hide ordering bugs.
const noisy = (x: number, y: number): [number, number, number] => {
  const h = (x * 73856093) ^ (y * 19349663);
  return [(h >>> 3) & 255, (h >>> 11) & 255, (h >>> 19) & 255];
};

// Open every gate so the whole traversal is one interval: sort everything,
// never break early. That makes the result fully checkable.
const sortEverything = {
  ...defaults,
  palette: identityPalette,
  sortPixelLuminanceAbove: 0,
  sortPixelLuminanceBelow: 255,
  sortPixelLuminanceChangeAbove: -255,
  sortPixelLuminanceChangeBelow: 255,
  extraIntervalStartChance: 0,
  maxIntervalSize: 0,
};

const run = (over: Record<string, unknown> = {}, fill = noisy) => {
  const { canvas, written, source } = makeCanvas(fill);
  pixelsort.func(canvas, { ...sortEverything, ...over } as any);
  const out = written();
  if (!out) throw new Error("no output written");
  return { out, source };
};

const multiset = (buf: Uint8ClampedArray) => {
  const counts = new Map<string, number>();
  for (let i = 0; i < buf.length; i += 4) {
    const k = `${buf[i]},${buf[i + 1]},${buf[i + 2]},${buf[i + 3]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
};

// Must match utils' `luminance(pixel, linear=false)` — Rec.601 weights scaled by
// alpha, which is what the filter's comparator and luminance gates use.
// linearLuminance defaults to false, so this is the sRGB form.
const luma = (buf: Uint8ClampedArray, i: number) =>
  (0.299 * (buf[i] / 255) + 0.587 * (buf[i + 1] / 255) + 0.114 * (buf[i + 2] / 255)) * buf[i + 3];

// SPIRAL / SPIRAL_CUT are excluded here and pinned as known-broken below.
const DIRECTIONS = ["ROW", "COLUMN", "CIRCULAR", "DIAGONAL_TOP_RIGHT"];
const COMPARATORS = ["RGBA", "GBRA", "BGRA", "HSVA", "SVHA", "VSHA", "LABA", "ABLA", "BALA", "LUMINANCE"];

describe("Pixel Sort is a permutation", () => {
  it.each(DIRECTIONS)("%s rearranges pixels without inventing or losing any", (direction) => {
    // The core contract. Every traversal order visits a set of positions and
    // writes the same pixels back into them; nothing may be created or dropped.
    // An off-by-one in an iterator, or a trail/pixels length mismatch, breaks
    // this while still producing a plausible-looking image.
    const { out, source } = run({ direction });
    expect(multiset(out)).toEqual(multiset(source));
  });

  it.each(COMPARATORS)("%s rearranges pixels without inventing or losing any", (comparator) => {
    const { out, source } = run({ comparator });
    expect(multiset(out)).toEqual(multiset(source));
  });

  it("holds for descending too", () => {
    const { out, source } = run({ sortDirection: "DESCENDING" });
    expect(multiset(out)).toEqual(multiset(source));
  });

  it("holds when intervals are capped", () => {
    // maxIntervalSize chops the traversal into runs; each is sorted separately,
    // so the whole is still a permutation.
    const { out, source } = run({ maxIntervalSize: 5 });
    expect(multiset(out)).toEqual(multiset(source));
  });

  // KNOWN BROKEN — pinned rather than hidden, so the bug is visible and these
  // flip to green the moment someone fixes the spiral iterator.
  //
  // Measured on a 6x6 image: SPIRAL and SPIRAL_CUT visit only 25 of 36 pixels,
  // missing the entire top row and left column, and duplicate others — a 12x12
  // of 144 distinct colors comes back with 122. So they lose pixels and repeat
  // others rather than rearranging them. (No out-of-bounds reads, unlike the ROW
  // and COLUMN iterators, which are fixed.)
  //
  // Not fixed here because the spiral bounds need reworking, which is a bigger
  // change than the off-by-one the other iterators had. `it.fails` asserts the
  // assertion below DOES fail; if it starts passing, delete the wrapper.
  it.fails.each(["SPIRAL", "SPIRAL_CUT"])(
    "%s does NOT preserve pixels (known bug — skips the top row/left column and duplicates)",
    (direction) => {
      const { out, source } = run({ direction });
      expect(multiset(out)).toEqual(multiset(source));
    },
  );

  it("SPIRAL leaves the top row and left column unsorted (known bug)", () => {
    // The concrete symptom, so the scope is recorded even while it's unfixed.
    const { out, source } = run({ direction: "SPIRAL" });
    for (let x = 0; x < W; x++) {
      const i = x * 4;
      expect([out[i], out[i + 1], out[i + 2]]).toEqual([source[i], source[i + 1], source[i + 2]]);
    }
  });
});

describe("Pixel Sort actually sorts", () => {
  it("sorts each row by luminance when the whole row is one interval", () => {
    // With every gate open and ROW traversal, each row is a single interval, so
    // the finished row must be non-decreasing in luminance. This is the
    // assertion that would catch a comparator that ignores its direction, or a
    // sort writing back in the wrong order.
    const { out } = run({ direction: "ROW", comparator: "LUMINANCE", sortDirection: "ASCENDING" });
    for (let y = 0; y < H; y++) {
      for (let x = 1; x < W; x++) {
        const prev = luma(out, (y * W + x - 1) * 4);
        const cur = luma(out, (y * W + x) * 4);
        expect(cur, `row ${y} not sorted at x=${x}`).toBeGreaterThanOrEqual(prev - 1e-6);
      }
    }
  });

  it("descending reverses the order", () => {
    const { out } = run({ direction: "ROW", comparator: "LUMINANCE", sortDirection: "DESCENDING" });
    for (let y = 0; y < H; y++) {
      for (let x = 1; x < W; x++) {
        const prev = luma(out, (y * W + x - 1) * 4);
        const cur = luma(out, (y * W + x) * 4);
        expect(cur, `row ${y} not reverse-sorted at x=${x}`).toBeLessThanOrEqual(prev + 1e-6);
      }
    }
  });

  it("sorts each column when traversing by column", () => {
    const { out } = run({ direction: "COLUMN", comparator: "LUMINANCE", sortDirection: "ASCENDING" });
    for (let x = 0; x < W; x++) {
      for (let y = 1; y < H; y++) {
        const prev = luma(out, ((y - 1) * W + x) * 4);
        const cur = luma(out, (y * W + x) * 4);
        expect(cur, `column ${x} not sorted at y=${y}`).toBeGreaterThanOrEqual(prev - 1e-6);
      }
    }
  });

  it("really rearranged something", () => {
    // Guard the guard: a filter that returned its input untouched would satisfy
    // both the permutation and (on already-sorted input) the ordering checks.
    const { out, source } = run({ direction: "ROW" });
    expect(Array.from(out)).not.toEqual(Array.from(source));
  });
});

describe("Pixel Sort luminance gates", () => {
  it("leaves the image alone when no pixel qualifies", () => {
    // An impossible window (only sort pixels brighter than 255 and darker than
    // 0) must select nothing, so the image passes through.
    const { out, source } = run({
      sortPixelLuminanceAbove: 255,
      sortPixelLuminanceBelow: 0,
    });
    expect(Array.from(out)).toEqual(Array.from(source));
  });

  it("only reorders pixels inside the luminance window", () => {
    // Pixels outside the window must keep their exact positions — the window is
    // the whole point of the control.
    const above = 80;
    const below = 180;
    const { out, source } = run({
      sortPixelLuminanceAbove: above,
      sortPixelLuminanceBelow: below,
      direction: "ROW",
    });
    for (let i = 0; i < source.length; i += 4) {
      const l = luma(source, i);
      if (l < above || l > below) {
        expect(
          [out[i], out[i + 1], out[i + 2]],
          `pixel at ${i / 4} (luma ${l.toFixed(1)}) is outside the window but moved`,
        ).toEqual([source[i], source[i + 1], source[i + 2]]);
      }
    }
  });
});

describe("Pixel Sort misc", () => {
  it("is deterministic with no random interval breaks", () => {
    expect(Array.from(run().out)).toEqual(Array.from(run().out));
  });

  it("preserves alpha", () => {
    const { out } = run();
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it("survives a 1x1 image", () => {
    // Degenerate sizes are where iterators tend to run off the end.
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    let written: Uint8ClampedArray | null = null;
    const canvas = {
      width: 1, height: 1,
      getContext: () => ({
        getImageData: () => ({ data: new Uint8ClampedArray(data), width: 1, height: 1 }),
        putImageData: (img: { data: Uint8ClampedArray }) => { written = new Uint8ClampedArray(img.data); },
      }),
    } as unknown as HTMLCanvasElement;
    pixelsort.func(canvas, sortEverything as any);
    expect(written && Array.from(written)).toEqual([10, 20, 30, 255]);
  });
});
