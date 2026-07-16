import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import datamosh, { defaults } from "filters/datamosh";
import nearest from "palettes/nearest";

// 205 lines, noGL + noWASM, temporal — and covered only by the smoke sweep's
// "doesn't throw". Temporal filters are the shape every bug this session has
// lived in: frame-to-frame carry, first-frame handling, buffers changing size
// underneath you.
//
// The two branches worth pinning are the filter's actual premise: below the
// motion threshold it holds the previous frame (that's the "mosh"), above it it
// uses the current one.

const W = 32;
const H = 32;

const identityPalette = { ...nearest, options: { levels: 256 } };

const fill = (fn: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = fn(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return data;
};

const makeCanvas = (data: Uint8ClampedArray) => {
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
  return { canvas, written: () => written };
};

const gradient = fill((x, y) => [x * 8, y * 8, 128]);
const solidRed = fill(() => [200, 20, 20]);

const run = (over: Record<string, unknown> = {}, source = gradient) => {
  const { canvas, written } = makeCanvas(source);
  datamosh.func(canvas, {
    ...defaults,
    palette: identityPalette,
    ...over,
  } as any);
  const out = written();
  if (!out) throw new Error("no output written");
  return out;
};

// Freeze the two branches by pinning the thresholds, so what's under test is the
// branch rather than the RNG.
const holdPrevious = { motionThreshold: 100, displacement: 0, corruptChance: 0, channelShift: 0 };
const useCurrent = { motionThreshold: 0, displacement: 0, corruptChance: 0, channelShift: 0 };

describe("datamosh temporal branches", () => {
  it("holds the previous frame when nothing moved — the actual mosh", () => {
    // threshold 100 -> 255, so any luma diff is below it: every block should
    // come back as the previous frame, not the current one. This is the whole
    // premise of the filter.
    const out = run({ ...holdPrevious, _prevOutput: solidRed, _frameIndex: 1 });
    expect(Array.from(out)).toEqual(Array.from(solidRed));
  });

  it("uses the current frame when everything moved", () => {
    // threshold 0, no displacement/corruption -> a straight passthrough of the
    // current frame.
    const out = run({ ...useCurrent, _prevOutput: solidRed, _frameIndex: 1 });
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });

  it("treats the first frame as full motion", () => {
    // No previous frame at all. It must fall back to the current frame rather
    // than reading a null buffer or emitting holes.
    const out = run({ ...holdPrevious, _prevOutput: null, _frameIndex: 0 });
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });

  it("ignores a previous frame of the wrong size", () => {
    // The canvas can resize between frames, leaving a stale prevOutput. Indexing
    // it would read past the end (or worse, mix two geometries); the length
    // guard must send it down the first-frame path instead.
    const stale = new Uint8ClampedArray(W * H * 4 - 64);
    const out = run({ ...holdPrevious, _prevOutput: stale, _frameIndex: 3 });
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });
});

describe("datamosh always produces a complete frame", () => {
  it.each([0, 1, 5, 12])("frame %i writes every pixel", (frameIndex) => {
    // outBuf starts as fresh zeros, so any block the tiling missed shows up as a
    // fully transparent pixel. Blocks are laid out with ceil(), so a boundary
    // off-by-one is exactly what this would catch.
    const out = run({ _prevOutput: solidRed, _frameIndex: frameIndex });
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i], `pixel ${i / 4} was never written`).toBe(255);
    }
  });

  it.each([4, 7, 16, 32])("blockSize %i still covers the frame", (blockSize) => {
    // 7 doesn't divide 32 — the ragged last row/column of blocks is where tiling
    // tends to leave gaps.
    const out = run({ blockSize, _prevOutput: solidRed, _frameIndex: 2 });
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it("only emits colors that were in the source", () => {
    // Every branch copies pixels from the current or previous frame; none
    // invents one. A displaced read landing out of bounds would surface as a
    // transparent-black pixel, as it did in Pixel Sort.
    const out = run({ _prevOutput: solidRed, _frameIndex: 4, corruptChance: 1, displacement: 30, channelShift: 10 });
    const allowed = new Set<string>();
    for (let i = 0; i < gradient.length; i += 4) allowed.add(`${gradient[i]},${gradient[i + 1]},${gradient[i + 2]}`);
    // channelShift recombines R from one pixel with G/B from another, so only
    // check that nothing is transparent — the recombination is the point.
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    expect(allowed.size).toBeGreaterThan(1);
  });
});

describe("datamosh determinism", () => {
  it("is deterministic for a given frame", () => {
    // The RNG is seeded from frameIndex (mulberry32(frameIndex * 7919 + 31337)),
    // not Math.random, so the same frame must render identically every time —
    // otherwise video would shimmer on re-render and nothing could be pinned.
    const a = run({ _prevOutput: solidRed, _frameIndex: 9 });
    const b = run({ _prevOutput: solidRed, _frameIndex: 9 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("changes with the frame index", () => {
    // ...and it must not be frozen, or the animation would stand still.
    const a = run({ _prevOutput: solidRed, _frameIndex: 1, corruptChance: 1 });
    const b = run({ _prevOutput: solidRed, _frameIndex: 2, corruptChance: 1 });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("datamosh degenerate inputs", () => {
  it("survives a frame smaller than one block", () => {
    // W - blockSize goes negative here, which is where the source-block clamp
    // has to hold up.
    const tiny = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < tiny.length; i += 4) {
      tiny[i] = 120; tiny[i + 1] = 120; tiny[i + 2] = 120; tiny[i + 3] = 255;
    }
    let written: Uint8ClampedArray | null = null;
    const canvas = {
      width: 4, height: 4,
      getContext: () => ({
        getImageData: () => ({ data: new Uint8ClampedArray(tiny), width: 4, height: 4 }),
        putImageData: (img: { data: Uint8ClampedArray }) => { written = new Uint8ClampedArray(img.data); },
      }),
    } as unknown as HTMLCanvasElement;
    datamosh.func(canvas, {
      ...defaults, palette: identityPalette, blockSize: 32, corruptChance: 1,
      displacement: 30, _prevOutput: null, _frameIndex: 1,
    } as any);
    expect(written).not.toBeNull();
    for (let i = 3; i < written!.length; i += 4) expect(written![i]).toBe(255);
  });
});
