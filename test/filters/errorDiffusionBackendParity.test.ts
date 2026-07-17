import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// cloneCanvas needs a real canvas to drawImage from; identity is enough here
// and is what the sibling conformance tests do.
vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import { initWasmFromBinary } from "@gyng/ditherer-filters";
import { floydSteinberg, stucki } from "filters/errorDiffusing";
import { ORDER, TEMPORAL_MODE } from "filters/errorDiffusingFilterFactory";
import user from "palettes/user";
import { LAB_NEAREST, OKLAB_NEAREST } from "constants/color";

// Error diffusion with a custom-colour palette, JS loop vs Rust kernel.
//
// Error diffusion is the configuration that matters: it carries accumulated
// error as floats, so the palette sees channels like 250.4 rather than the
// integers every other path hands it. That is exactly where the two
// implementations can disagree, and exactly what the whole-buffer parity grids
// — which only ever pass integers — cannot check.
//
// Sizes are deliberate. Divergence here cascades: one flipped near-tie changes
// what its neighbours receive, so a small fixture reports a different
// phenomenon rather than a smaller one. Lab measured 7% at 12x9 and 41% at
// 128x128 from the *same* fault (docs/plan/059). Anything asserting parity has
// to do it somewhere big enough to cascade.
//
// Bit-for-bit rather than a tolerance: both algorithms are built so there is no
// float drift to forgive, and a tolerance would let the real mistakes through
// (truncation instead of rounding in oklab_from_f32; the LUT instead of powf in
// rgba2laba).

const PALETTE = [
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [255, 0, 0, 255],
  [0, 0, 255, 255],
  [0, 255, 0, 255],
  [255, 255, 0, 255],
];

// A gradient with hard edges. Flat colour would let a broken kernel look
// correct: no error to misplace and nothing fractional.
const makeSource = (W: number, H: number) => {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = Math.round((x / (W - 1)) * 255);
      rgba[i + 1] = Math.round((y / (H - 1)) * 255);
      rgba[i + 2] = (x + y) % 3 === 0 ? 200 : 40;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
};

const makeCanvas = (W: number, H: number, data: Uint8ClampedArray) => {
  const source = new Uint8ClampedArray(data);
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: W,
    height: H,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(source), width: W, height: H }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        written = new Uint8ClampedArray(img.data);
      },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, written: () => written };
};

const run = (
  filter: { func: (c: HTMLCanvasElement, o: never) => unknown },
  W: number,
  H: number,
  algo: string,
  wasm: boolean,
): Uint8ClampedArray => {
  const { canvas, written } = makeCanvas(W, H, makeSource(W, H));
  filter.func(canvas, {
    serpentine: false,
    scanOrder: ORDER.HORIZONTAL,
    temporalMode: TEMPORAL_MODE.OFF,
    temporalBleed: 0,
    palette: { ...user, options: { colors: PALETTE, colorDistanceAlgorithm: algo } },
    _linearize: false,
    _wasmAcceleration: wasm,
  } as never);
  const result = written();
  if (!result) throw new Error("filter produced no output — nothing was written back");
  return result;
};

// Count differing pixels rather than `expect(wasm).toEqual(js)`. Equality on two
// differing 262,144-element arrays sends vitest off building a diff of the whole
// thing: 46 seconds, then an unreadable dump. A count fails instantly and says
// the one thing worth knowing — how far apart they are, which is also how you
// tell a cascade (thousands) from a single flipped tie (one).
const diffPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
};

const expectBackendsAgree = (
  filter: { func: (c: HTMLCanvasElement, o: never) => unknown },
  W: number,
  H: number,
  algo: string,
) => {
  const differing = diffPixels(run(filter, W, H, algo, true), run(filter, W, H, algo, false));
  const total = W * H;
  expect(
    differing,
    `${differing}/${total} pixels (${((differing / total) * 100).toFixed(2)}%) differ between ` +
      `the WASM kernel and the JS loop at ${W}x${H}`,
  ).toBe(0);
};

const distinctColors = (buf: Uint8ClampedArray) => {
  const seen = new Set<string>();
  for (let i = 0; i < buf.length; i += 4) seen.add(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`);
  return seen.size;
};

const inPalette = (buf: Uint8ClampedArray) => {
  const allowed = new Set(PALETTE.map((c) => `${c[0]},${c[1]},${c[2]}`));
  for (let i = 0; i < buf.length; i += 4) {
    if (!allowed.has(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`)) return false;
  }
  return true;
};

describe("error diffusion — JS and WASM agree", () => {
  beforeAll(async () => {
    const wasmPath = resolve(
      __dirname,
      "../../packages/ditherer-filters/src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm",
    );
    await initWasmFromBinary(readFileSync(wasmPath));
  });

  // Lab was 38-54% apart until rgba2laba learned to linearise a fractional
  // channel exactly instead of rounding it into the f32 LUT — the LUT shape is
  // right for quantize_buffer_lab (integers) and wrong for rgba2lab_inline
  // (floats), and JS only had the one.
  //
  // 128x128 because 12x9 showed 7% for the same fault and would have read as a
  // rounding curiosity.
  it("Lab matches bit-for-bit at a size where divergence cascades", () => {
    expectBackendsAgree(floydSteinberg, 128, 128, LAB_NEAREST);
  });

  it("OKLab matches bit-for-bit", () => {
    expectBackendsAgree(floydSteinberg, 128, 128, OKLAB_NEAREST);
  });

  // Lab is exact-float on both sides now, so there is no quantization threshold
  // for a last-bit f64/f32 difference to trip. Stucki spreads error over 12 taps
  // and is the harshest case measured; if Lab ever regresses to a LUT this is
  // the test that catches it.
  it("Lab holds under the widest kernel at 256x256", () => {
    expectBackendsAgree(stucki, 256, 256, LAB_NEAREST);
  });

  // NOT asserted for OKLab, which diverges 15% at that size and is expected to.
  // Both sides round into the same LUT by design, so the LUT's hard threshold at
  // every .5 boundary turns JS's f64 error accumulation and Rust's f32 into
  // different palette entries. Left alone deliberately: every disagreement is a
  // sub-JND near-tie and both outputs are valid dithers. See docs/plan/059.

  it.each([
    ["Lab", LAB_NEAREST],
    ["OKLab", OKLAB_NEAREST],
  ])("%s emits only palette colours on both backends", (_name, algo: string) => {
    expect(inPalette(run(floydSteinberg, 64, 64, algo, true))).toBe(true);
    expect(inPalette(run(floydSteinberg, 64, 64, algo, false))).toBe(true);
  });

  // The agreement tests pass trivially if both backends collapse to one colour,
  // which is exactly how the original bug looked: every pixel matched to the
  // entry nearest black. Both sides must actually use the palette.
  it.each([
    ["Lab", LAB_NEAREST],
    ["OKLab", OKLAB_NEAREST],
  ])("%s uses more than a couple of the six palette entries", (_name, algo: string) => {
    expect(distinctColors(run(floydSteinberg, 64, 64, algo, true))).toBeGreaterThan(2);
    expect(distinctColors(run(floydSteinberg, 64, 64, algo, false))).toBeGreaterThan(2);
  });
});
