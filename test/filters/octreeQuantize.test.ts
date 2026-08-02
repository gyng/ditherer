import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import octreeQuantize, { defaults } from "filters/octreeQuantize";

// Octree Quantize is noGL + noWASM, so this JS is the only path there is — 217
// lines of tree insertion and reducible-node walking whose entire coverage was
// "doesn't throw" and "alpha > 100". A reduction that merged the wrong depth and
// silently collapsed the palette to ~8 colours would pass all of that.
//
// There's no canonical octree output to diff against (the reduction order is an
// implementation choice), so these are properties rather than an oracle: the
// palette is bounded, the output only uses colours the octree actually produced,
// and the levels knob does what it says.

const W = 16;
const H = 16;

const makeCanvas = (fill: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: W,
    height: H,
    getContext: (type: string) =>
      type === "2d"
        ? {
            getImageData: () => ({ data: new Uint8ClampedArray(data), width: W, height: H }),
            putImageData: (img: { data: Uint8ClampedArray }) => {
              written = new Uint8ClampedArray(img.data);
            },
          }
        : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, written: () => written };
};

// A busy image — many distinct colours, so reduction has real work to do.
const rainbow = (x: number, y: number): [number, number, number] => [
  (x * 16) % 256,
  (y * 16) % 256,
  ((x + y) * 8) % 256,
];

const run = (over: Record<string, unknown> = {}, fill = rainbow) => {
  const { canvas, written } = makeCanvas(fill);
  octreeQuantize.func(canvas, { ...defaults, ...over } as any);
  const out = written();
  if (!out) throw new Error("no output written");
  return out;
};

const distinctColors = (buf: Uint8ClampedArray) => {
  const set = new Set<string>();
  for (let i = 0; i < buf.length; i += 4) set.add(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`);
  return set;
};

describe("Octree Quantize", () => {
  // Regression: this used to hang the tab, not fail.
  //
  // reduceTree() merges one node per call and the root is never registered as
  // reducible, so the tree bottoms out at one leaf per occupied top-level octant
  // — at most 8. Asking for fewer than that left `while (leafCount > maxColors)`
  // calling a reduceTree() that could no longer reduce anything, spinning
  // forever. levels is a [2,64] slider, so dragging it to 2 on a colourful image
  // froze the app outright. Needs enough distinct colours to fill the octants,
  // which is why the default of 12 never showed it.
  //
  // The tight timeout is the point: without it a regression stalls the run
  // instead of reporting.
  it.each([2, 3, 4, 6, 8])(
    "terminates at levels=%i, below the octree's own floor",
    (levels) => {
      const colors = distinctColors(run({ levels, sampleRate: 1 }));
      expect(colors.size).toBeGreaterThan(0);
      expect(colors.size).toBeLessThanOrEqual(levels);
    },
    5000,
  );

  it("never emits more colors than requested", () => {
    // The whole contract of the levels knob. A broken reducible-node walk could
    // stop early and leave the palette far larger than asked for.
    for (const levels of [2, 4, 12, 32]) {
      const colors = distinctColors(run({ levels }));
      expect(colors.size, `levels=${levels} produced ${colors.size} colors`).toBeLessThanOrEqual(
        levels,
      );
    }
  });

  it("actually reduces — a rainbow does not survive intact", () => {
    // 256 source colors in, at most 12 out by default.
    const source = distinctColors(run({ levels: 64, sampleRate: 1 }));
    const reduced = distinctColors(run({ levels: 4, sampleRate: 1 }));
    expect(reduced.size).toBeLessThan(source.size);
    expect(reduced.size).toBeLessThanOrEqual(4);
  });

  it("gives more colors as levels rises", () => {
    // Monotonicity: asking for more should not give you fewer. Catches a
    // reduction that collapses to a fixed depth regardless of the option.
    const few = distinctColors(run({ levels: 3, sampleRate: 1 })).size;
    const many = distinctColors(run({ levels: 32, sampleRate: 1 })).size;
    expect(many).toBeGreaterThan(few);
  });

  it("is deterministic", () => {
    expect(Array.from(run({ levels: 8 }))).toEqual(Array.from(run({ levels: 8 })));
  });

  it("leaves a flat image flat", () => {
    // One input colour can only average to itself; anything else means the leaf
    // sums or pixel counts are wrong.
    const out = run({ levels: 8 }, () => [37, 142, 200]);
    expect(distinctColors(out)).toEqual(new Set(["37,142,200"]));
  });

  it("keeps output colors near the source", () => {
    // Octree leaves hold averages of the pixels that landed in them, so every
    // emitted colour must sit inside the source's range — not drift outside it.
    const out = run({ levels: 8 }, (x, y) => [100 + (x % 4), 100 + (y % 4), 100]);
    for (const key of distinctColors(out)) {
      const [r, g, b] = key.split(",").map(Number);
      expect(r).toBeGreaterThanOrEqual(100);
      expect(r).toBeLessThanOrEqual(103);
      expect(g).toBeGreaterThanOrEqual(100);
      expect(g).toBeLessThanOrEqual(103);
      expect(b).toBe(100);
    }
  });

  it("preserves alpha", () => {
    const out = run({ levels: 8 });
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it("honors both reduce modes", () => {
    // Both ENUM branches must run and produce a bounded palette; POPULARITY is
    // otherwise reachable by no assertion at all.
    for (const reduceMode of ["MERGE", "POPULARITY"]) {
      const colors = distinctColors(run({ reduceMode, levels: 8, sampleRate: 1 }));
      expect(colors.size, `${reduceMode} produced ${colors.size}`).toBeLessThanOrEqual(8);
      expect(colors.size).toBeGreaterThan(1);
    }
  });

  it("still bounds the palette when sampling skips pixels", () => {
    // sampleRate builds the octree from a subset, but every pixel still gets
    // mapped. A colour that no sampled pixel produced must not appear.
    const out = run({ levels: 6, sampleRate: 8 });
    expect(distinctColors(out).size).toBeLessThanOrEqual(6);
  });
});
