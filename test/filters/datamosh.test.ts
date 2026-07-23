import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import datamosh, { defaults } from "filters/datamosh";
import nearest from "palettes/nearest";

// Temporal, noGL + noWASM. Datamosh now applies real per-block motion
// compensation: on a mosh frame it predicts each block from the previous
// OUTPUT frame at the motion-compensated position; on a keyframe (the refresh
// interval, or when reference frames are missing/wrong-size) it emits the clean
// current frame. These tests pin those branches plus tiling coverage and
// determinism.

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

// A zero-motion mosh: previous input equals the current frame, so every block's
// vector is (0,0) and the prediction is exactly the previous OUTPUT frame.
const zeroMotionMosh = {
  _prevInput: gradient, displacement: 0, corruptChance: 0, channelShift: 0, _frameIndex: 1,
};

describe("datamosh temporal branches", () => {
  it("predicts the reference (previous output) frame when nothing moved", () => {
    // No inter-frame motion -> vectors are zero -> the moshed frame is exactly
    // the held previous output, not the current input. This is the whole premise.
    const out = run({ ...zeroMotionMosh, _prevOutput: solidRed });
    expect(Array.from(out)).toEqual(Array.from(solidRed));
  });

  it("motion-compensates by the detected translation (pins vector direction and magnitude)", () => {
    // The current frame is the previous input translated by +3 px in x
    // (prevInput(x) = current(x-3)), so the estimator must find vector (+3,0)
    // and predict each block from prevOutput sampled at (x+3, y). A sign flip
    // or wrong magnitude changes the sampled pixel, which a solid reference
    // cannot catch — so the reference here is the non-uniform gradient.
    const prevInputShifted = fill((x, y) => [Math.max(0, x - 3) * 8, y * 8, 128]);
    const out = run({
      _prevInput: prevInputShifted, _prevOutput: gradient,
      displacement: 6, corruptChance: 0, channelShift: 0, blockSize: 16, _frameIndex: 1,
    });
    const px = (x: number, y: number) => { const i = (y * W + x) * 4; return [out[i], out[i + 1], out[i + 2]]; };
    expect(px(10, 10)).toEqual([13 * 8, 10 * 8, 128]); // = gradient(13, 10)
  });

  it("does not drift a flat block off the zero vector (motion-search zero bias)", () => {
    // A flat current/previous input makes every displacement tie; the search
    // must resolve to (0,0), so the reference passes through unshifted. Without
    // the zero bias it would creep diagonally by the full search radius.
    const flat = fill(() => [100, 100, 100]);
    const out = run({
      _prevInput: flat, _prevOutput: gradient,
      displacement: 8, corruptChance: 0, channelShift: 0, _frameIndex: 1,
    }, flat);
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });

  it("emits the clean current frame on a keyframe refresh", () => {
    // frameIndex 0 hits the keyframe interval -> a clean passthrough of current.
    const out = run({
      _prevInput: gradient, _prevOutput: solidRed, corruptChance: 0, channelShift: 0,
      keyframeInterval: 24, _frameIndex: 0,
    });
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });

  it("treats a missing reference as a keyframe", () => {
    // No previous frames at all -> emit the current frame rather than reading a
    // null buffer or leaving holes.
    const out = run({ _prevInput: null, _prevOutput: null, _frameIndex: 1 });
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });

  it("ignores a previous frame of the wrong size", () => {
    // The canvas can resize between frames, leaving a stale prevOutput. The
    // length guard must send it down the keyframe path instead of indexing past
    // the end.
    const stale = new Uint8ClampedArray(W * H * 4 - 64);
    const out = run({ _prevInput: gradient, _prevOutput: stale, _frameIndex: 3 });
    expect(Array.from(out)).toEqual(Array.from(gradient));
  });
});

describe("datamosh always produces a complete frame", () => {
  it.each([0, 1, 5, 12])("frame %i writes every pixel", (frameIndex) => {
    // outBuf starts as fresh zeros, so any block the tiling missed shows up as a
    // fully transparent pixel. Blocks are laid out with ceil(), so a boundary
    // off-by-one is exactly what this would catch. Both keyframe (0) and mosh
    // (1/5/12) paths must cover the frame.
    const out = run({ _prevInput: solidRed, _prevOutput: solidRed, _frameIndex: frameIndex });
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i], `pixel ${i / 4} was never written`).toBe(255);
    }
  });

  it.each([4, 7, 16, 32])("blockSize %i still covers the frame", (blockSize) => {
    // 7 doesn't divide 32 — the ragged last row/column of blocks is where tiling
    // tends to leave gaps.
    const out = run({ blockSize, _prevInput: solidRed, _prevOutput: solidRed, _frameIndex: 2 });
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it("never leaves an out-of-bounds gather transparent", () => {
    // Corrupt vectors plus a large search radius and channel shift push reads
    // far out of frame; the coordinate clamp must keep every pixel opaque.
    const out = run({ _prevInput: solidRed, _prevOutput: solidRed, _frameIndex: 4, corruptChance: 1, displacement: 30, channelShift: 10 });
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
});

describe("datamosh determinism", () => {
  it("is deterministic for a given frame", () => {
    // The corrupt-vector RNG is seeded from frameIndex (not Math.random), so the
    // same frame must render identically every time — otherwise video would
    // shimmer on re-render and nothing could be pinned.
    const a = run({ _prevInput: solidRed, _prevOutput: gradient, _frameIndex: 9, corruptChance: 1 });
    const b = run({ _prevInput: solidRed, _prevOutput: gradient, _frameIndex: 9, corruptChance: 1 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("changes with the frame index", () => {
    // ...and it must not be frozen, or the animation would stand still. A
    // non-uniform reference makes the per-frame corrupt offsets visible.
    const a = run({ _prevInput: solidRed, _prevOutput: gradient, _frameIndex: 1, corruptChance: 1, displacement: 12 });
    const b = run({ _prevInput: solidRed, _prevOutput: gradient, _frameIndex: 2, corruptChance: 1, displacement: 12 });
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
