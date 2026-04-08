/**
 * Color distance algorithm benchmarks.
 * Run with: npx vitest bench test/perf/colorDistanceBench
 *
 * Measures the hot path: colorDistance() called once per palette color per
 * pixel. Run this before and after perf changes to quantify improvement.
 *
 * Two suites:
 *   "single pair"   — raw colorDistance() cost for one (palette, pixel) call
 *   "palette scan"  — full nearest-color search over 16 CGA colors (the real hot path)
 *
 * WASM is loaded directly from the .wasm binary (bypassing Vite's ?init
 * transform which does not work in Node/jsdom) so WASM algorithms are
 * measured at their true cost alongside the JS alternatives.
 */
import { describe, bench, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { colorDistance, rgba2laba } from "utils";
import {
  RGB_NEAREST,
  RGB_APPROX,
  HSV_NEAREST,
  LAB_NEAREST,
} from "constants/color";

// ---------------------------------------------------------------------------
// Fixed inputs — representative, deterministic
// ---------------------------------------------------------------------------

// Mid-tone purple pixel (exercises all branches of the sRGB→Lab gamma curve)
const PIXEL = [128, 64, 192, 255];

// CGA 16-color palette (inline so the bench is self-contained)
const CGA_16: number[][] = [
  [0,   0,   0,   255],
  [0,   0,   170, 255],
  [0,   170, 0,   255],
  [0,   170, 170, 255],
  [170, 0,   0,   255],
  [170, 0,   170, 255],
  [170, 170, 0,   255],
  [170, 170, 170, 255],
  [85,  85,  85,  255],
  [85,  85,  255, 255],
  [85,  255, 85,  255],
  [85,  255, 255, 255],
  [255, 85,  85,  255],
  [255, 85,  255, 255],
  [255, 255, 85,  255],
  [255, 255, 255, 255],
];

const PAL_COLOR = CGA_16[4]; // red — first palette entry used for single-pair benches

// CIE 1931 D65 reference white (matches utils/index.ts referenceTable.CIE_1931.D65)
const REF_X = 95.047;
const REF_Y = 100.0;
const REF_Z = 108.883;

// ---------------------------------------------------------------------------
// WASM — loaded directly from the binary, bypassing Vite's ?init transform
// ---------------------------------------------------------------------------

// Raw WASM export: rgba_laba_distance(r1,g1,b1,a1, r2,g2,b2,a2, rx,ry,rz) → f64
type WasmDistFn = (
  r1: number, g1: number, b1: number, a1: number,
  r2: number, g2: number, b2: number, a2: number,
  rx: number, ry: number, rz: number,
) => number;

let wasmDist: WasmDistFn | null = null;

// Batch WASM: rgba_nearest_lab_index(r,g,b,a, palette_ptr,palette_len, rx,ry,rz) → index
// We call it through a JS wrapper that handles memory allocation.
type WasmBatchFn = (pixel: number[], palette: Float64Array) => number;
let wasmBatch: WasmBatchFn | null = null;

// Pre-built flat palettes for WASM benches
let CGA_16_FLAT: Float64Array | null = null;  // RGBA f64
let CGA_16_LAB: Float64Array | null = null;   // Lab f64 (pre-converted)

// Full image buffer for buffer-quantize bench (320×240)
const BENCH_W = 320;
const BENCH_H = 240;
let BENCH_BUF: Uint8Array | null = null;

// Buffer quantize functions (one per algorithm)
type WasmQuantizeFn = (buf: Uint8Array, palette: Float64Array) => Uint8Array;
type WasmQuantizeLabFn = (buf: Uint8Array, palette: Float64Array) => Uint8Array;
let wasmQuantize: WasmQuantizeLabFn | null = null;
let wasmQuantizeRgb: WasmQuantizeFn | null = null;
let wasmQuantizeRgbApprox: WasmQuantizeFn | null = null;
let wasmQuantizeHsv: WasmQuantizeFn | null = null;

// Pre-computed per-pixel function
type WasmPrecomputedFn = (pixel: number[], paletteLab: Float64Array) => number;
let wasmPrecomputed: WasmPrecomputedFn | null = null;

beforeAll(async () => {
  // Build flat palette RGBA
  CGA_16_FLAT = new Float64Array(CGA_16.length * 4);
  for (let i = 0; i < CGA_16.length; i++) {
    CGA_16_FLAT[i * 4]     = CGA_16[i][0];
    CGA_16_FLAT[i * 4 + 1] = CGA_16[i][1];
    CGA_16_FLAT[i * 4 + 2] = CGA_16[i][2];
    CGA_16_FLAT[i * 4 + 3] = CGA_16[i][3];
  }

  // Build pre-converted Lab palette [L,a,b, L,a,b, …]
  CGA_16_LAB = new Float64Array(CGA_16.length * 3);
  for (let i = 0; i < CGA_16.length; i++) {
    const lab = rgba2laba(CGA_16[i]);
    CGA_16_LAB[i * 3]     = lab[0];
    CGA_16_LAB[i * 3 + 1] = lab[1];
    CGA_16_LAB[i * 3 + 2] = lab[2];
  }

  // Deterministic noise buffer for full-buffer bench (320×240)
  BENCH_BUF = new Uint8Array(BENCH_W * BENCH_H * 4);
  for (let i = 0; i < BENCH_BUF.length; i++) {
    BENCH_BUF[i] = (i * 2654435761) & 0xff;
  }

  try {
    const wasmPath = resolve(process.cwd(), "src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm");
    const buf = await readFile(wasmPath);
    const imports = {
      "./rgba2laba_bg.js": {
        __wbindgen_init_externref_table: () => {},
      },
    };
    const { instance } = await WebAssembly.instantiate(buf, imports);
    const exports = instance.exports as any;

    wasmDist = exports.rgba_laba_distance as WasmDistFn;

    const malloc = exports.__wbindgen_malloc as (size: number, align: number) => number;

    // Helper: copy f64 array into WASM memory, return (ptr, len)
    const passF64 = (arr: Float64Array): [number, number] => {
      const ptr = malloc(arr.length * 8, 8) >>> 0;
      new Float64Array(exports.memory.buffer).set(arr, ptr / 8);
      return [ptr, arr.length];
    };

    // Helper: copy u8 array into WASM memory, return (ptr, len)
    const passU8 = (arr: Uint8Array): [number, number] => {
      const ptr = malloc(arr.length, 1) >>> 0;
      new Uint8Array(exports.memory.buffer).set(arr, ptr);
      return [ptr, arr.length];
    };

    // Batch per-pixel: palette RGBA re-converted each pixel (old)
    if (malloc && exports.rgba_nearest_lab_index) {
      wasmBatch = (pixel: number[], palette: Float64Array): number => {
        const [ptr, len] = passF64(palette);
        return exports.rgba_nearest_lab_index(
          pixel[0], pixel[1], pixel[2], pixel[3],
          ptr, len, REF_X, REF_Y, REF_Z,
        ) >>> 0;
      };
    }

    // Pre-computed Lab palette per-pixel search
    if (malloc && exports.nearest_lab_precomputed) {
      wasmPrecomputed = (pixel: number[], paletteLab: Float64Array): number => {
        const [ptr, len] = passF64(paletteLab);
        return exports.nearest_lab_precomputed(
          pixel[0], pixel[1], pixel[2],
          ptr, len, REF_X, REF_Y, REF_Z,
        ) >>> 0;
      };
    }

    // Helper: call a WASM buffer quantize fn and return the result Vec<u8>
    const makeQuantizeFn = (wasmFn: Function, ...extraArgs: number[]) => {
      return (buf: Uint8Array, palette: Float64Array): Uint8Array => {
        const [bPtr, bLen] = passU8(buf);
        const [pPtr, pLen] = passF64(palette);
        const ret = wasmFn(bPtr, bLen, pPtr, pLen, ...extraArgs);
        const outPtr = ret[0] >>> 0;
        const outLen = ret[1] >>> 0;
        const result = new Uint8Array(exports.memory.buffer, outPtr, outLen).slice();
        exports.__wbindgen_free(outPtr, outLen, 1);
        return result;
      };
    };

    if (malloc) {
      if (exports.quantize_buffer_lab)
        wasmQuantize = makeQuantizeFn(exports.quantize_buffer_lab, REF_X, REF_Y, REF_Z);
      if (exports.quantize_buffer_rgb)
        wasmQuantizeRgb = makeQuantizeFn(exports.quantize_buffer_rgb);
      if (exports.quantize_buffer_rgb_approx)
        wasmQuantizeRgbApprox = makeQuantizeFn(exports.quantize_buffer_rgb_approx);
      if (exports.quantize_buffer_hsv)
        wasmQuantizeHsv = makeQuantizeFn(exports.quantize_buffer_hsv);
    }
  } catch (e) {
    console.warn("WASM load failed — skipping WASM benches:", (e as Error).message);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mirrors user.ts:getColor — nearest-color scan using colorDistance()
const nearestColorJs = (pixel: number[], palette: number[][], algo: string): number[] => {
  let best: number[] | null = null;
  let bestDist = 0;
  for (const pc of palette) {
    const d = colorDistance(pc, pixel, algo);
    if (best === null || d < bestDist) { best = pc; bestDist = d; }
  }
  return best!;
};

// Nearest-color scan using the raw WASM rgba_laba_distance export
const nearestColorWasm = (pixel: number[], palette: number[][]): number[] => {
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (const pc of palette) {
    const d = wasmDist!(
      pc[0], pc[1], pc[2], pc[3],
      pixel[0], pixel[1], pixel[2], pixel[3],
      REF_X, REF_Y, REF_Z,
    );
    if (d < bestDist) { best = pc; bestDist = d; }
  }
  return best!;
};

// Nearest-color scan computing Lab in JS then doing the distance manually —
// equivalent to what WASM_LAB_NEAREST_MEMO_PALETTE does on the pixel side
const nearestColorJsLabManual = (pixel: number[], palette: number[][]): number[] => {
  const bLab = rgba2laba(pixel);
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (const pc of palette) {
    const aLab = rgba2laba(pc);
    const d = Math.sqrt(
      (bLab[0] - aLab[0]) ** 2 +
      (bLab[1] - aLab[1]) ** 2 +
      (bLab[2] - aLab[2]) ** 2,
    );
    if (d < bestDist) { best = pc; bestDist = d; }
  }
  return best!;
};

// ---------------------------------------------------------------------------
// Suite 1: single (palette color, pixel) pair
// ---------------------------------------------------------------------------

describe("colorDistance — single pair", () => {
  bench("RGB_NEAREST", () => {
    colorDistance(PAL_COLOR, PIXEL, RGB_NEAREST);
  });

  bench("RGB_APPROX", () => {
    colorDistance(PAL_COLOR, PIXEL, RGB_APPROX);
  });

  bench("HSV_NEAREST", () => {
    colorDistance(PAL_COLOR, PIXEL, HSV_NEAREST);
  });

  bench("LAB_NEAREST (JS)", () => {
    colorDistance(PAL_COLOR, PIXEL, LAB_NEAREST);
  });

  bench("LAB_NEAREST (WASM raw)", () => {
    if (!wasmDist) return;
    wasmDist(
      PAL_COLOR[0], PAL_COLOR[1], PAL_COLOR[2], PAL_COLOR[3],
      PIXEL[0], PIXEL[1], PIXEL[2], PIXEL[3],
      REF_X, REF_Y, REF_Z,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 2: nearest-color scan over 16 CGA palette entries (real hot path)
// ---------------------------------------------------------------------------

describe("palette scan — 16 CGA colors", () => {
  bench("RGB_NEAREST", () => {
    nearestColorJs(PIXEL, CGA_16, RGB_NEAREST);
  });

  bench("RGB_APPROX", () => {
    nearestColorJs(PIXEL, CGA_16, RGB_APPROX);
  });

  bench("HSV_NEAREST", () => {
    nearestColorJs(PIXEL, CGA_16, HSV_NEAREST);
  });

  bench("LAB_NEAREST (JS)", () => {
    nearestColorJs(PIXEL, CGA_16, LAB_NEAREST);
  });

  bench("LAB_NEAREST (JS, manual — no switch overhead)", () => {
    nearestColorJsLabManual(PIXEL, CGA_16);
  });

  bench("LAB_NEAREST (WASM raw, 16 calls)", () => {
    if (!wasmDist) return;
    nearestColorWasm(PIXEL, CGA_16);
  });

  bench("LAB_NEAREST (WASM batch, 1 call)", () => {
    if (!wasmBatch) return;
    wasmBatch(PIXEL, CGA_16_FLAT!);
  });

  bench("LAB_NEAREST (WASM precomputed Lab, 1 call)", () => {
    if (!wasmPrecomputed) return;
    wasmPrecomputed(PIXEL, CGA_16_LAB!);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: full buffer quantization (320×240 = 76,800 pixels)
// ---------------------------------------------------------------------------

describe("buffer quantize — 320×240 (76,800 pixels, single WASM call)", () => {
  bench("RGB_NEAREST", () => {
    if (!wasmQuantizeRgb) return;
    wasmQuantizeRgb(BENCH_BUF!, CGA_16_FLAT!);
  });

  bench("RGB_APPROX", () => {
    if (!wasmQuantizeRgbApprox) return;
    wasmQuantizeRgbApprox(BENCH_BUF!, CGA_16_FLAT!);
  });

  bench("HSV_NEAREST", () => {
    if (!wasmQuantizeHsv) return;
    wasmQuantizeHsv(BENCH_BUF!, CGA_16_FLAT!);
  });

  bench("LAB_NEAREST", () => {
    if (!wasmQuantize) return;
    wasmQuantize(BENCH_BUF!, CGA_16_FLAT!);
  });
});
