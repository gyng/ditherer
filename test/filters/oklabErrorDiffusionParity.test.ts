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
import { floydSteinberg } from "filters/errorDiffusing";
import { ORDER, TEMPORAL_MODE } from "filters/errorDiffusingFilterFactory";
import user from "palettes/user";
import { OKLAB_NEAREST } from "constants/color";

// OKLab error diffusion, JS vs the Rust kernel, on a custom-colour palette.
//
// This pair had no coverage and both halves were broken in different ways:
// colorAlgorithmToWasmMode returned null for OKLab (so WASM never ran), and the
// JS fallback read fractional channels as black. Neither failed loudly.
//
// Error diffusion is what makes this the interesting configuration: it carries
// accumulated error as floats, so the palette sees channels like 250.4 rather
// than the integers every other path hands it. That is precisely where the two
// implementations can disagree, and precisely what the whole-buffer parity
// grids — which only ever pass integers — cannot check.
//
// Bit-for-bit is the bar here rather than a tolerance because a tolerance would
// let a truncation bug through, and truncation (clamp_u8_f32 instead of
// js_round_f32 in the Rust `oklab_from_f32`) is the specific mistake this shape
// exists to prevent — it diverges the two backends immediately.
//
// But that equality is EMPIRICAL ON THIS FIXTURE, not structural, and the
// comment here used to claim otherwise. JS accumulates the diffused error in
// f64 (readF32 widens out of the Float32Array and the arithmetic runs as JS
// numbers) while the Rust kernel accumulates in f32. Those disagree in the last
// bits, and the LUT turns that into a *hard* decision: an index rounds at every
// .5 boundary, so a last-bit difference occasionally picks a different entry,
// and error diffusion then cascades it. Measured: Stucki at 256x256 on a
// 16-colour palette diverges 10052/65536 (15%) even for OKLab. RGB, RGB_APPROX,
// HSV and LEVELS stay at 0 at that size, because they compare distances rather
// than quantizing to a LUT index, so a last-bit difference cannot flip them.
//
// So this file guards the wiring and the rounding rule — the things that broke —
// and does not certify the two backends as interchangeable at any size. See
// docs/plan/059-lab-fractional-parity.md.
//
// Lab is deliberately NOT asserted here. It diverges far worse (~38-54% of
// pixels at realistic sizes) because JS rounds into the LUT while Rust's
// rgba2lab_inline linearises the exact float with powf — a whole different
// conversion, not a last-bit effect. Real, predates this file, and pinning it
// would freeze whichever side happens to be canonical.

const W = 12;
const H = 9;

const PALETTE = [
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [255, 0, 0, 255],
  [0, 0, 255, 255],
  [0, 255, 0, 255],
  [255, 255, 0, 255],
];

// A gradient with hard edges. Flat colour would let a broken kernel look
// correct, since there'd be no error to misplace and nothing fractional.
const makeSource = () => {
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

const makeCanvas = (data: Uint8ClampedArray) => {
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

const run = (wasm: boolean): Uint8ClampedArray => {
  const { canvas, written } = makeCanvas(makeSource());
  floydSteinberg.func(canvas, {
    serpentine: false,
    scanOrder: ORDER.HORIZONTAL,
    temporalMode: TEMPORAL_MODE.OFF,
    temporalBleed: 0,
    palette: { ...user, options: { colors: PALETTE, colorDistanceAlgorithm: OKLAB_NEAREST } },
    _linearize: false,
    _wasmAcceleration: wasm,
  } as never);
  const result = written();
  if (!result) throw new Error("filter produced no output — nothing was written back");
  return result;
};

const inPalette = (buf: Uint8ClampedArray) => {
  const allowed = new Set(PALETTE.map((c) => `${c[0]},${c[1]},${c[2]}`));
  for (let i = 0; i < buf.length; i += 4) {
    if (!allowed.has(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`)) return false;
  }
  return true;
};

const distinctColors = (buf: Uint8ClampedArray) => {
  const seen = new Set<string>();
  for (let i = 0; i < buf.length; i += 4) seen.add(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`);
  return seen.size;
};

describe("OKLab error diffusion", () => {
  beforeAll(async () => {
    const wasmPath = resolve(
      __dirname,
      "../../packages/ditherer-filters/src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm",
    );
    await initWasmFromBinary(readFileSync(wasmPath));
  });

  it("agrees bit-for-bit between the JS loop and the Rust kernel", () => {
    expect(run(true)).toEqual(run(false));
  });

  it.each([
    ["WASM", true],
    ["JS", false],
  ])("%s emits only palette colours", (_name, wasm: boolean) => {
    expect(inPalette(run(wasm))).toBe(true);
  });

  // The agreement test above passes trivially if both backends collapse to one
  // colour — which is exactly how the original bug looked, since every pixel
  // matched to the entry nearest black. Both sides must actually use the
  // palette for the parity assertion to mean anything.
  it.each([
    ["WASM", true],
    ["JS", false],
  ])("%s uses more than a couple of the six palette entries", (_name, wasm: boolean) => {
    expect(distinctColors(run(wasm))).toBeGreaterThan(2);
  });
});
