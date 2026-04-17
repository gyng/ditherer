// NO WEBGL PATH:
// Error-diffusion dithering (Floyd-Steinberg, Atkinson, Jarvis, Stucki,
// Sierra, Burkes, and every other kernel this factory produces) has a hard
// sequential data dependency — each pixel's quantised output feeds error into
// forward neighbours that haven't been processed yet. Fragment shaders are
// strictly gather-only and process all pixels in parallel, so the algorithm
// can't be expressed in GL without changing the output semantics. The WASM
// path handles this well and is the permanent home for these filters.
// Parallel dithering (Bayer matrices, blue noise, halftone) is covered by
// `ordered.ts` / `halftone.ts`, both of which are GL-accelerated.
import {
  cloneCanvas,
  fillBufferPixel,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  linearPaletteGetColor,
  wasmErrorDiffuseBuffer,
  wasmErrorDiffuseCustomOrder,
  wasmIsLoaded,
  colorAlgorithmToWasmMode,
  resolvePaletteColorAlgorithm,
  logFilterWasmStatus,
  WASM_PALETTE_MODE,
  WASM_ROW_ALT,
  WASM_ERR_STRATEGY,
} from "utils";
import type { FilterDefinition, FilterOptionValues } from "filters/types";

import { BOOL, ENUM, PALETTE, RANGE, ACTION } from "constants/controlTypes";
import * as palettes from "palettes";

// Top-level scan strategy. Horizontal/Vertical sweep rows or columns and use
// the row-alternation pattern; the rest walk the image in their own order and
// ignore rowAlternation.
export const ORDER = {
  HORIZONTAL: "HORIZONTAL",
  VERTICAL: "VERTICAL",
  HILBERT: "HILBERT",
  SPIRAL: "SPIRAL",
  DIAGONAL: "DIAGONAL",
  RANDOM_PIXEL: "RANDOM_PIXEL",
};

// Per-row direction pattern, only meaningful for HORIZONTAL/VERTICAL scan orders.
export const ROW_ALT = {
  BOUSTROPHEDON: "BOUSTROPHEDON",
  REVERSE: "REVERSE",
  BLOCK2: "BLOCK2",
  BLOCK3: "BLOCK3",
  BLOCK4: "BLOCK4",
  BLOCK8: "BLOCK8",
  TRIANGULAR: "TRIANGULAR",
  GRAYCODE: "GRAYCODE",
  BITREVERSE: "BITREVERSE",
  PRIME: "PRIME",
  RANDOM: "RANDOM",
};

// How to distribute the per-pixel error in custom-order scans (Hilbert/Spiral/
// Diagonal/Random Pixel). Each strategy trades off energy preservation vs.
// visible boundary artifacts ("stitch seams").
export const ERR_STRATEGY = {
  RENORMALIZE: "RENORMALIZE", // energy-preserving — visible seams at sub-quadrant boundaries
  CLAMPED:     "CLAMPED",     // renormalize but cap the scale factor (default)
  DROP:        "DROP",        // raw weights, energy lost into visited targets — darker output
  ROTATE:      "ROTATE",      // rotate kernel each step to follow the curve direction
  SYMMETRIC:   "SYMMETRIC",   // ignore filter kernel, use uniform 8-neighbor distribution
};

export const TEMPORAL_MODE = {
  OFF: "OFF",
  BLEED: "BLEED",
  VOTE: "VOTE",
};

const CUSTOM_ORDERS = new Set<string>([
  ORDER.HILBERT, ORDER.SPIRAL, ORDER.DIAGONAL, ORDER.RANDOM_PIXEL,
]);

// Cap for CLAMPED renormalization. ~2× lets pixels with most neighbors
// already-visited push a bit harder without spiking 8–16× as bare
// renormalization does at sub-quadrant boundaries.
const CLAMP_MAX_SCALE = 2;

// Uniform 8-neighbor kernel for the SYMMETRIC strategy. Total weight = 1.
const SYMMETRIC_TUPLES = [
  { dx: -1, dy: -1, weight: 1 / 8 },
  { dx:  0, dy: -1, weight: 1 / 8 },
  { dx:  1, dy: -1, weight: 1 / 8 },
  { dx: -1, dy:  0, weight: 1 / 8 },
  { dx:  1, dy:  0, weight: 1 / 8 },
  { dx: -1, dy:  1, weight: 1 / 8 },
  { dx:  0, dy:  1, weight: 1 / 8 },
  { dx:  1, dy:  1, weight: 1 / 8 },
];
const readU8 = (buf: Uint8ClampedArray, index: number) => buf[index] ?? 0;
const readF32 = (buf: Float32Array, index: number) => buf[index] ?? 0;
const readTuple = (tuples: Tuple[], index: number): Tuple => tuples[index] ?? { dx: 0, dy: 0, weight: 0 };

type ErrorDiffusingRuntimeOptions = FilterOptionValues & {
  palette?: {
    getColor?: {
      bivarianceHack(color: number[], options?: FilterOptionValues): number[];
    }["bivarianceHack"];
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  serpentine?: boolean;
  temporalMode?: string;
  temporalBleed?: number;
  voteWindow?: number;
  scanOrder?: string;
  rowAlternation?: string;
  errorStrategy?: string;
  _frameIndex?: number;
  _prevInput?: Uint8ClampedArray | null;
  _prevOutput?: Uint8ClampedArray | null;
  _linearize?: boolean;
};

// Visibility predicates: only show row-major options when scanOrder is row-major,
// only show errorStrategy when scanOrder is custom-order.
const isRowMajorOrder = (opts: ErrorDiffusingRuntimeOptions) =>
  !CUSTOM_ORDERS.has(opts.scanOrder || ORDER.HORIZONTAL);
const isCustomOrderOpts = (opts: ErrorDiffusingRuntimeOptions) =>
  CUSTOM_ORDERS.has(opts.scanOrder || ORDER.HORIZONTAL);
const usesTemporalBleed = (opts: ErrorDiffusingRuntimeOptions) =>
  (opts.temporalMode || TEMPORAL_MODE.BLEED) === TEMPORAL_MODE.BLEED;
const usesTemporalVote = (opts: ErrorDiffusingRuntimeOptions) =>
  opts.temporalMode === TEMPORAL_MODE.VOTE;

export const optionTypes = {
  serpentine: { type: BOOL, default: true, visibleWhen: isRowMajorOrder, desc: "Alternate scan direction per row to reduce directional artifacts (only affects Horizontal/Vertical scan orders)" },
  scanOrder: { type: ENUM, options: [
    { name: "Horizontal", value: ORDER.HORIZONTAL },
    { name: "Vertical", value: ORDER.VERTICAL },
    { name: "Hilbert Curve", value: ORDER.HILBERT },
    { name: "Spiral", value: ORDER.SPIRAL },
    { name: "Diagonal", value: ORDER.DIAGONAL },
    { name: "Random Pixel", value: ORDER.RANDOM_PIXEL },
  ], default: ORDER.HORIZONTAL, desc: "How pixels are walked. Horizontal/Vertical sweep rows or columns; the rest follow space-filling or chaotic visit orders." },
  rowAlternation: { type: ENUM, options: [
    { name: "Boustrophedon", value: ROW_ALT.BOUSTROPHEDON },
    { name: "Reverse", value: ROW_ALT.REVERSE },
    { name: "2-Row Blocks", value: ROW_ALT.BLOCK2 },
    { name: "3-Row Blocks", value: ROW_ALT.BLOCK3 },
    { name: "4-Row Blocks", value: ROW_ALT.BLOCK4 },
    { name: "8-Row Blocks", value: ROW_ALT.BLOCK8 },
    { name: "Triangular", value: ROW_ALT.TRIANGULAR },
    { name: "Gray Code", value: ROW_ALT.GRAYCODE },
    { name: "Bit Reverse", value: ROW_ALT.BITREVERSE },
    { name: "Prime", value: ROW_ALT.PRIME },
    { name: "Random", value: ROW_ALT.RANDOM },
  ], default: ROW_ALT.BOUSTROPHEDON,
    visibleWhen: (opts: ErrorDiffusingRuntimeOptions) => isRowMajorOrder(opts) && opts.serpentine !== false,
    desc: "Per-row direction pattern. Only applies to Horizontal/Vertical scan orders." },
  errorStrategy: { type: ENUM, options: [
    { name: "Renormalize", value: ERR_STRATEGY.RENORMALIZE },
    { name: "Renormalize (Clamped)", value: ERR_STRATEGY.CLAMPED },
    { name: "Drop", value: ERR_STRATEGY.DROP },
    { name: "Rotate Kernel", value: ERR_STRATEGY.ROTATE },
    { name: "Symmetric", value: ERR_STRATEGY.SYMMETRIC },
  ], default: ERR_STRATEGY.CLAMPED,
    visibleWhen: isCustomOrderOpts,
    desc: "How error gets distributed to unvisited neighbors in custom-order scans (Hilbert/Spiral/Diagonal/Random Pixel). Renormalize is energy-preserving but creates visible seams at curve sub-quadrant boundaries; Clamped caps the spike; Drop loses energy (darker output) but has no seams; Rotate aligns the kernel with the local curve direction; Symmetric replaces the filter's kernel with a uniform 8-neighbor distribution." },
  temporalMode: {
    type: ENUM,
    options: [
      { name: "Bleed", value: TEMPORAL_MODE.BLEED },
      { name: "Vote", value: TEMPORAL_MODE.VOTE },
      { name: "Off", value: TEMPORAL_MODE.OFF },
    ],
    default: TEMPORAL_MODE.BLEED,
    desc: "Temporal carryover via residual bleed, temporal consensus via voting, or fully static diffusion",
  },
  temporalBleed: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0,
    visibleWhen: usesTemporalBleed,
    desc: "Carry quantization error across frames — higher = more temporal detail recovery",
  },
  voteWindow: {
    type: RANGE,
    range: [3, 9],
    step: 2,
    default: 5,
    visibleWhen: usesTemporalVote,
    desc: "How many recent quantized frames participate in the temporal vote consensus",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  serpentine: optionTypes.serpentine.default,
  scanOrder: optionTypes.scanOrder.default,
  rowAlternation: optionTypes.rowAlternation.default,
  errorStrategy: optionTypes.errorStrategy.default,
  temporalMode: optionTypes.temporalMode.default,
  temporalBleed: optionTypes.temporalBleed.default,
  voteWindow: optionTypes.voteWindow.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: optionTypes.palette.default
};

// Transpose an interleaved RGBA Uint8ClampedArray of size w*h.
// Used by VERTICAL serpentine to reuse the standard horizontal scan/kernel
// code: transpose in, scan, transpose out.
const transposeRGBA8 = (src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray<ArrayBuffer> => {
  const dst = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = (y * w + x) * 4;
      const di = (x * h + y) * 4;
      dst[di] = readU8(src, si);
      dst[di + 1] = readU8(src, si + 1);
      dst[di + 2] = readU8(src, si + 2);
      dst[di + 3] = readU8(src, si + 3);
    }
  }
  return dst;
};

// Trial-division primality test. Cheap enough for a per-row check up to ~10⁴ rows.
const isPrime = (n: number): boolean => {
  if (n < 2) return false;
  if (n < 4) return true;
  if ((n & 1) === 0) return false;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
};

// Bit-reverse the low log2(H) bits of y. Produces a chaotic-but-deterministic
// row direction that's distinct from the multiplicative-hash Random mode.
const bitReverseParity = (y: number, H: number): number => {
  let bits = 1;
  while ((1 << bits) < H) bits += 1;
  let r = 0;
  for (let b = 0; b < bits; b += 1) if (y & (1 << b)) r |= 1 << (bits - 1 - b);
  return r & 1;
};

// Triangular: segment lengths grow 1,2,3,4,... Find which segment row y is in
// (segment k spans rows [k(k+1)/2, (k+1)(k+2)/2)) and use the segment parity.
const triangularSegment = (y: number): number =>
  Math.floor((-1 + Math.sqrt(1 + 8 * y)) / 2);

// Convert a 2D kernel/offset pair into a flat (dx, dy, weight) tuple list,
// dropping nulls and the self-pixel. Used by the custom-order scan path so
// kernel application can run as a flat loop with visited-target skipping.
type Tuple = { dx: number; dy: number; weight: number };
const kernelToTuples = (
  kernel: (number | null)[][],
  offset: number[]
): { tuples: Tuple[]; total: number } => {
  const tuples: Tuple[] = [];
  let total = 0;
  for (let h = 0; h < kernel.length; h += 1) {
    const row = kernel[h] ?? [];
    for (let w = 0; w < row.length; w += 1) {
      const weight = row[w];
      if (weight == null) continue;
      const dx = w + (offset[0] ?? 0);
      const dy = h + (offset[1] ?? 0);
      if (dx === 0 && dy === 0) continue;
      tuples.push({ dx, dy, weight });
      total += weight;
    }
  }
  return { tuples, total };
};

// Rotate a tuple set by N×90° clockwise in screen coordinates (y points down).
// Used by the ROTATE error strategy to align the kernel with the local curve
// direction. dir: 0 = forward right (+x), 1 = down (+y), 2 = left (-x), 3 = up (-y).
const rotateTuples = (tuples: Tuple[], dir: number): Tuple[] =>
  tuples.map(({ dx, dy, weight }) => {
    let nx = dx;
    let ny = dy;
    for (let i = 0; i < dir; i += 1) {
      const t = nx;
      nx = -ny;
      ny = t;
    }
    return { dx: nx, dy: ny, weight };
  });

// For ROTATE: snap the next-step vector to the nearest cardinal direction.
// Returns 0/1/2/3 (right/down/left/up). Long jumps (e.g. Random Pixel mode)
// have no meaningful local direction and fall back to 0.
const snapDirection = (dx: number, dy: number): number => {
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  if (adx + ady === 0 || adx + ady > 2) return 0;
  if (adx >= ady) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
};

// === Visit-order builders for custom-order scan modes ===

// Hilbert space-filling curve. Pad image to next power-of-2 for the curve,
// then drop out-of-bounds points. Adapted from the standard d2xy mapping.
const hilbertOrder = (W: number, H: number): Int32Array => {
  let n = 1;
  while (n < W || n < H) n *= 2;
  const order = new Int32Array(W * H);
  let idx = 0;
  for (let d = 0; d < n * n; d += 1) {
    let x = 0;
    let y = 0;
    let t = d;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        const tmp = x;
        x = y;
        y = tmp;
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    if (x < W && y < H) order[idx++] = y * W + x;
  }
  return order;
};

// Clockwise outside-in spiral.
const spiralOrder = (W: number, H: number): Int32Array => {
  const order = new Int32Array(W * H);
  let idx = 0;
  let top = 0;
  let bot = H - 1;
  let left = 0;
  let right = W - 1;
  while (top <= bot && left <= right) {
    for (let x = left; x <= right; x += 1) order[idx++] = top * W + x;
    top += 1;
    for (let y = top; y <= bot; y += 1) order[idx++] = y * W + right;
    right -= 1;
    if (top <= bot) {
      for (let x = right; x >= left; x -= 1) order[idx++] = bot * W + x;
      bot -= 1;
    }
    if (left <= right) {
      for (let y = bot; y >= top; y -= 1) order[idx++] = y * W + left;
      left += 1;
    }
  }
  return order;
};

// Anti-diagonal serpentine: walk top-left→bottom-right diagonals, alternating
// the within-diagonal direction so adjacent diagonals snake into each other.
const diagonalOrder = (W: number, H: number): Int32Array => {
  const order = new Int32Array(W * H);
  let idx = 0;
  for (let d = 0; d < W + H - 1; d += 1) {
    const xMin = Math.max(0, d - H + 1);
    const xMax = Math.min(W - 1, d);
    if ((d & 1) === 0) {
      for (let x = xMin; x <= xMax; x += 1) order[idx++] = (d - x) * W + x;
    } else {
      for (let x = xMax; x >= xMin; x -= 1) order[idx++] = (d - x) * W + x;
    }
  }
  return order;
};

// Random pixel order: Fisher-Yates with a stable LCG seeded by W,H so the
// shuffle is deterministic across frames (no flicker during animation).
const randomPixelOrder = (W: number, H: number): Int32Array => {
  const order = new Int32Array(W * H);
  for (let i = 0; i < order.length; i += 1) order[i] = i;
  let seed = ((W * 73856093) ^ (H * 19349663)) >>> 0;
  for (let i = order.length - 1; i > 0; i -= 1) {
    seed = ((seed * 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    const tmp = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = tmp;
  }
  return order;
};

const buildVisitOrder = (order: string, W: number, H: number): Int32Array => {
  if (order === ORDER.HILBERT) return hilbertOrder(W, H);
  if (order === ORDER.SPIRAL) return spiralOrder(W, H);
  if (order === ORDER.DIAGONAL) return diagonalOrder(W, H);
  return randomPixelOrder(W, H); // RANDOM_PIXEL fallback
};

const majorityColorAt = (
  frames: Uint8ClampedArray[],
  filled: number,
  pixelIndex: number
) => {
  let bestColor = 0;
  let bestCount = -1;
  let bestLastSeen = -1;

  for (let f = 0; f < filled; f += 1) {
    const frame = frames[f];
    if (!frame) continue;
    const color = (
      ((readU8(frame, pixelIndex) << 24) >>> 0) |
      (readU8(frame, pixelIndex + 1) << 16) |
      (readU8(frame, pixelIndex + 2) << 8) |
      readU8(frame, pixelIndex + 3)
    ) >>> 0;
    let count = 1;
    let lastSeen = f;
    for (let g = f + 1; g < filled; g += 1) {
      const compare = frames[g];
      if (!compare) continue;
      const compareColor = (
        ((readU8(compare, pixelIndex) << 24) >>> 0) |
        (readU8(compare, pixelIndex + 1) << 16) |
        (readU8(compare, pixelIndex + 2) << 8) |
        readU8(compare, pixelIndex + 3)
      ) >>> 0;
      if (compareColor === color) {
        count += 1;
        lastSeen = g;
      }
    }
    if (count > bestCount || (count === bestCount && lastSeen > bestLastSeen)) {
      bestColor = color;
      bestCount = count;
      bestLastSeen = lastSeen;
    }
  }

  return bestColor >>> 0;
};

export const errorDiffusingFilter = (
  name: string,
  errorMatrix: any,
  defaultOptions: any
): FilterDefinition => {
  let voteFrames: Uint8ClampedArray[] = [];
  let voteHead = 0;
  let voteWidth = 0;
  let voteHeight = 0;
  let voteDepth = 0;
  let voteLastFrameIndex = -1;

  const resetVoteState = (width: number, height: number, depth: number) => {
    voteFrames = [];
    voteHead = 0;
    voteWidth = width;
    voteHeight = height;
    voteDepth = depth;
  };

  const filter = (
    input: any,
    options: ErrorDiffusingRuntimeOptions = defaultOptions
  ) => {
    const palette = (options.palette ?? defaultOptions.palette) as NonNullable<
      ErrorDiffusingRuntimeOptions["palette"]
    >;
    const serpentine = options.serpentine !== undefined ? options.serpentine : true;
    const temporalMode = options.temporalMode || defaults.temporalMode;
    const temporalBleed = options.temporalBleed || 0;
    const voteWindow = Math.max(3, Math.round(options.voteWindow || defaults.voteWindow));
    const frameIndex = Number(options._frameIndex || 0);
    const prevInput = options._prevInput ?? null;
    const prevOutput = options._prevOutput ?? null;

    const scanOrder: string = options.scanOrder || ORDER.HORIZONTAL;
    const rowAlt: string = options.rowAlternation || ROW_ALT.BOUSTROPHEDON;
    const errorStrategy: string = options.errorStrategy || ERR_STRATEGY.CLAMPED;

    const output = cloneCanvas(input, true);
    const outputCtx = output.getContext("2d");
    if (!outputCtx) return input;

    const realW = output.width;
    const realH = output.height;
    let buf = outputCtx.getImageData(0, 0, realW, realH).data;
    if (!buf) return input;

    // Custom-order modes (Hilbert/Spiral/Diagonal/Random Pixel) use a separate
    // visit-order scan path. rowAlternation is ignored for those.
    const isCustomOrder = CUSTOM_ORDERS.has(scanOrder);

    // Vertical row-major mode: transpose so the standard horizontal scan/kernel
    // code naturally produces a column-wise scan with a 90°-rotated kernel.
    const isVertical = scanOrder === ORDER.VERTICAL;
    let prevInputForLoop: Uint8ClampedArray | null = prevInput;
    let prevOutputForLoop: Uint8ClampedArray | null = prevOutput;
    if (isVertical) {
      buf = transposeRGBA8(buf, realW, realH);
      if (prevInput && prevInput.length === realW * realH * 4) {
        prevInputForLoop = transposeRGBA8(prevInput, realW, realH);
      }
      if (prevOutput && prevOutput.length === realW * realH * 4) {
        prevOutputForLoop = transposeRGBA8(prevOutput, realW, realH);
      }
    }
    const W = isVertical ? realH : realW;
    const H = isVertical ? realW : realH;

    const useLinear = options._linearize;

    // WASM fast path: covers the sRGB, row-major, boustrophedon case that's
    // ~95% of real use. Custom scan orders, linear mode, alternate row patterns,
    // active temporal bleed, and VOTE mode all fall through to the JS loops below.
    const bleedActive =
      temporalMode === TEMPORAL_MODE.BLEED &&
      temporalBleed > 0 &&
      prevInputForLoop != null &&
      prevOutputForLoop != null &&
      prevInputForLoop.length === buf.length &&
      prevOutputForLoop.length === buf.length;
    // Translate the JS-side ROW_ALT string to the WASM enum. Anything we don't
    // recognise falls back to BOUSTROPHEDON (the default), which is fine since
    // we only look at this value when serpentine is on.
    const ROW_ALT_TO_WASM: Record<string, number> = {
      [ROW_ALT.BOUSTROPHEDON]: WASM_ROW_ALT.BOUSTROPHEDON,
      [ROW_ALT.REVERSE]:       WASM_ROW_ALT.REVERSE,
      [ROW_ALT.BLOCK2]:        WASM_ROW_ALT.BLOCK2,
      [ROW_ALT.BLOCK3]:        WASM_ROW_ALT.BLOCK3,
      [ROW_ALT.BLOCK4]:        WASM_ROW_ALT.BLOCK4,
      [ROW_ALT.BLOCK8]:        WASM_ROW_ALT.BLOCK8,
      [ROW_ALT.TRIANGULAR]:    WASM_ROW_ALT.TRIANGULAR,
      [ROW_ALT.GRAYCODE]:      WASM_ROW_ALT.GRAYCODE,
      [ROW_ALT.BITREVERSE]:    WASM_ROW_ALT.BITREVERSE,
      [ROW_ALT.PRIME]:         WASM_ROW_ALT.PRIME,
      [ROW_ALT.RANDOM]:        WASM_ROW_ALT.RANDOM,
    };

    let didWasm = false;
    let wasmReason = "";
    if (!options._wasmAcceleration) wasmReason = "_wasmAcceleration off";
    else if (!wasmIsLoaded()) wasmReason = "wasm not loaded yet";

    if (!wasmReason) {
      const pOpts = palette?.options as
        | { colors?: number[][]; levels?: number }
        | undefined;
      let paletteMode: number | null = null;
      let paletteColors: number[][] | null = null;
      let levelsArg = 0;
      if (pOpts?.colors) {
        const algo = resolvePaletteColorAlgorithm(palette);
        const mode = algo ? colorAlgorithmToWasmMode(algo) : null;
        if (mode !== null) {
          paletteMode = mode;
          paletteColors = pOpts.colors;
        } else {
          wasmReason = `palette algo=${algo ?? "none"}`;
        }
      }
      if (paletteMode === null && typeof pOpts?.levels === "number") {
        paletteMode = WASM_PALETTE_MODE.LEVELS;
        levelsArg = pOpts.levels;
      }
      if (paletteMode === null && !wasmReason) {
        wasmReason = `palette ${(palette as { name?: string })?.name ?? "unknown"} unsupported`;
      }

      if (paletteMode !== null) {
        const bleedPrevIn  = bleedActive ? prevInputForLoop  : null;
        const bleedPrevOut = bleedActive ? prevOutputForLoop : null;

        if (isCustomOrder) {
          // Build a single visit order + the kernel-set buffer the WASM
          // function expects: for ROTATE we pre-rotate into 4 cardinal kernels;
          // for SYMMETRIC we substitute the 8-neighbor kernel; the rest just
          // use the filter's base kernel as the only entry.
          const visitOrder = buildVisitOrder(scanOrder, W, H);
          const visitOrderU32 = visitOrder instanceof Uint32Array
            ? visitOrder
            : new Uint32Array(visitOrder);

          const { tuples: baseTuples, total: kernelTotal } = kernelToTuples(errorMatrix.kernel, errorMatrix.offset);
          const useDrop      = errorStrategy === ERR_STRATEGY.DROP;
          const useClamp     = errorStrategy === ERR_STRATEGY.CLAMPED;
          const useRotate    = errorStrategy === ERR_STRATEGY.ROTATE;
          const useSymmetric = errorStrategy === ERR_STRATEGY.SYMMETRIC;
          const symTotal = SYMMETRIC_TUPLES.reduce((s, t) => s + t.weight, 0);

          let kernelSets: { dx: number; dy: number; weight: number }[][];
          let kernelSetTotals: number[];
          if (useRotate) {
            kernelSets = [0, 1, 2, 3].map(d => rotateTuples(baseTuples, d));
            kernelSetTotals = kernelSets.map(() => kernelTotal);
          } else if (useSymmetric) {
            kernelSets = [SYMMETRIC_TUPLES];
            kernelSetTotals = [symTotal];
          } else {
            kernelSets = [baseTuples];
            kernelSetTotals = [kernelTotal];
          }
          const totalTriples = kernelSets.reduce((s, k) => s + k.length, 0);
          const tuples = new Float32Array(totalTriples * 3);
          const starts = new Uint32Array(kernelSets.length);
          const lens = new Uint32Array(kernelSets.length);
          let cursor = 0;
          for (let i = 0; i < kernelSets.length; i += 1) {
            starts[i] = cursor;
            lens[i] = kernelSets[i].length;
            for (const t of kernelSets[i]) {
              tuples[cursor * 3]     = t.dx;
              tuples[cursor * 3 + 1] = t.dy;
              tuples[cursor * 3 + 2] = t.weight;
              cursor += 1;
            }
          }
          const totals = new Float32Array(kernelSetTotals);
          const wasmStrategy = useDrop ? WASM_ERR_STRATEGY.DROP
            : useClamp ? WASM_ERR_STRATEGY.CLAMPED
            : useRotate ? WASM_ERR_STRATEGY.ROTATE
            : useSymmetric ? WASM_ERR_STRATEGY.SYMMETRIC
            : WASM_ERR_STRATEGY.RENORMALIZE;

          wasmErrorDiffuseCustomOrder(
            buf, buf, W, H,
            visitOrderU32,
            tuples, starts, lens, totals,
            wasmStrategy, !!useLinear,
            bleedPrevIn, bleedPrevOut,
            bleedActive ? temporalBleed : 0,
            paletteMode, levelsArg,
            paletteColors,
          );
          didWasm = true;
        } else {
          const kw = errorMatrix.kernel[0].length;
          const kh = errorMatrix.kernel.length;
          const kernelFlat = new Float64Array(kw * kh);
          for (let h = 0; h < kh; h += 1) {
            const row = errorMatrix.kernel[h];
            if (!row) continue;
            for (let w = 0; w < kw; w += 1) {
              const v = row[w];
              if (typeof v === "number") kernelFlat[h * kw + w] = v;
            }
          }
          const rowAltCode = ROW_ALT_TO_WASM[rowAlt] ?? WASM_ROW_ALT.BOUSTROPHEDON;
          wasmErrorDiffuseBuffer(
            buf, buf, W, H,
            kernelFlat, kw, kh,
            errorMatrix.offset[0], errorMatrix.offset[1],
            !!serpentine, rowAltCode, !!useLinear,
            bleedPrevIn, bleedPrevOut,
            bleedActive ? temporalBleed : 0,
            paletteMode, levelsArg,
            paletteColors,
          );
          didWasm = true;
        }
      }
    }
    logFilterWasmStatus(name, didWasm, didWasm ? `palette=${(palette as { name?: string })?.name ?? "?"}${isCustomOrder ? ` order=${scanOrder}` : ""}` : (wasmReason || "unknown"));

    // errBuf: Float32Array for both paths — avoids boxed JS Array GC pressure.
    // Linear path: values 0.0–1.0. sRGB path: values 0–255 (float for error accumulation).
    const linearBuf = !didWasm && useLinear ? srgbBufToLinearFloat(buf) : null;
    const errBuf = didWasm
      ? new Float32Array(0)
      : useLinear
        ? new Float32Array(linearBuf!)
        : new Float32Array(buf);

    // Temporal error bleed should carry the previous frame's quantization
    // residual, not inject the current frame's whole input delta.
    if (
      !didWasm &&
      temporalMode === TEMPORAL_MODE.BLEED &&
      temporalBleed > 0 &&
      prevInputForLoop &&
      prevOutputForLoop &&
      prevInputForLoop.length === buf.length &&
      prevOutputForLoop.length === buf.length
    ) {
      if (useLinear) {
        const prevInputLinear = srgbBufToLinearFloat(prevInputForLoop);
        const prevOutputLinear = srgbBufToLinearFloat(prevOutputForLoop);
        for (let j = 0; j < errBuf.length; j += 4) {
          errBuf[j] = readF32(errBuf, j) + (readF32(prevInputLinear, j) - readF32(prevOutputLinear, j)) * temporalBleed;
          errBuf[j + 1] = readF32(errBuf, j + 1) + (readF32(prevInputLinear, j + 1) - readF32(prevOutputLinear, j + 1)) * temporalBleed;
          errBuf[j + 2] = readF32(errBuf, j + 2) + (readF32(prevInputLinear, j + 2) - readF32(prevOutputLinear, j + 2)) * temporalBleed;
        }
      } else {
        for (let j = 0; j < errBuf.length; j += 4) {
          errBuf[j] = readF32(errBuf, j) + (readU8(prevInputForLoop, j) - readU8(prevOutputForLoop, j)) * temporalBleed;
          errBuf[j + 1] = readF32(errBuf, j + 1) + (readU8(prevInputForLoop, j + 1) - readU8(prevOutputForLoop, j + 1)) * temporalBleed;
          errBuf[j + 2] = readF32(errBuf, j + 2) + (readU8(prevInputForLoop, j + 2) - readU8(prevOutputForLoop, j + 2)) * temporalBleed;
        }
      }
    }

    const kernelWidth = errorMatrix.kernel[0].length;
    const kernelHeight = errorMatrix.kernel.length;
    const offsetX = errorMatrix.offset[0];
    const offsetY = errorMatrix.offset[1];

    // Scratch buffer — avoids per-pixel array allocations in palette calls
    const _pix = [0, 0, 0, 0];

    if (!didWasm) {
    if (isCustomOrder) {
      // Custom-order scan: walk a precomputed visit order, push error only to
      // not-yet-visited targets. The errorStrategy option picks how the error
      // is distributed when neighbors are blocked (visible at curve sub-quadrant
      // boundaries — see ERR_STRATEGY for tradeoffs).
      const visitOrder = buildVisitOrder(scanOrder, W, H);
      const visited = new Uint8Array(W * H);
      const { tuples: baseTuples, total: kernelTotal } = kernelToTuples(errorMatrix.kernel, errorMatrix.offset);

      const useDrop      = errorStrategy === ERR_STRATEGY.DROP;
      const useClamp     = errorStrategy === ERR_STRATEGY.CLAMPED;
      const useRotate    = errorStrategy === ERR_STRATEGY.ROTATE;
      const useSymmetric = errorStrategy === ERR_STRATEGY.SYMMETRIC;

      // Pick the tuple set(s) we'll iterate over per pixel:
      // - SYMMETRIC: fixed uniform 8-neighbor, no rotation
      // - ROTATE: 4 precomputed cardinal rotations of the filter's kernel
      // - everything else: the filter's kernel as-is
      const symTotal = SYMMETRIC_TUPLES.reduce((s, t) => s + t.weight, 0);
      const rotatedSets: Tuple[][] = useRotate
        ? [0, 1, 2, 3].map(d => rotateTuples(baseTuples, d))
        : [];
      const staticTuples: Tuple[] = useSymmetric ? SYMMETRIC_TUPLES : baseTuples;
      const staticTotal = useSymmetric ? symTotal : kernelTotal;

      for (let step = 0; step < visitOrder.length; step += 1) {
        const linearIdx = visitOrder[step] ?? 0;
        visited[linearIdx] = 1;
        const x = linearIdx % W;
        const y = (linearIdx / W) | 0;
        const i = linearIdx * 4;

        let er: number;
        let eg: number;
        let eb: number;
        if (useLinear) {
          _pix[0] = readF32(errBuf, i); _pix[1] = readF32(errBuf, i + 1);
          _pix[2] = readF32(errBuf, i + 2); _pix[3] = readF32(errBuf, i + 3);
          const color = linearPaletteGetColor(palette, _pix, palette.options);
          er = _pix[0] - (color[0] ?? 0);
          eg = _pix[1] - (color[1] ?? 0);
          eb = _pix[2] - (color[2] ?? 0);
          linearBuf![i] = color[0] ?? 0;
          linearBuf![i + 1] = color[1] ?? 0;
          linearBuf![i + 2] = color[2] ?? 0;
        } else {
          const pr = readF32(errBuf, i);
          const pg = readF32(errBuf, i + 1);
          const pb = readF32(errBuf, i + 2);
          _pix[0] = pr; _pix[1] = pg; _pix[2] = pb; _pix[3] = readF32(errBuf, i + 3);
          const color = (palette.getColor ?? palettes.nearest.getColor)(
            _pix,
            palette.options as { levels: number } | undefined
          );
          fillBufferPixel(buf, i, color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, readU8(buf, i + 3));
          er = pr - (color[0] ?? 0);
          eg = pg - (color[1] ?? 0);
          eb = pb - (color[2] ?? 0);
        }

        // Choose this step's tuple set. ROTATE looks one step ahead in the
        // visit order to find the local "forward" cardinal and rotates the
        // kernel to match.
        let stepTuples: Tuple[];
        let stepTotal: number;
        if (useRotate && step + 1 < visitOrder.length) {
          const nextIdx = visitOrder[step + 1] ?? linearIdx;
          const nx = nextIdx % W;
          const ny = (nextIdx / W) | 0;
          stepTuples = rotatedSets[snapDirection(nx - x, ny - y)] ?? baseTuples;
          stepTotal = kernelTotal;
        } else {
          stepTuples = staticTuples;
          stepTotal = staticTotal;
        }
        const tupleCount = stepTuples.length;

        // Compute scale factor according to strategy.
        let scale = 1;
        if (!useDrop) {
          let unvisitedWeight = 0;
          for (let k = 0; k < tupleCount; k += 1) {
            const t = readTuple(stepTuples, k);
            const tx = x + t.dx;
            const ty = y + t.dy;
            if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
            if (visited[ty * W + tx]) continue;
            unvisitedWeight += t.weight;
          }
          if (unvisitedWeight === 0) continue;
          scale = stepTotal / unvisitedWeight;
          if (useClamp && scale > CLAMP_MAX_SCALE) scale = CLAMP_MAX_SCALE;
        }

        // Push error to unvisited targets.
        for (let k = 0; k < tupleCount; k += 1) {
          const t = readTuple(stepTuples, k);
          const tx = x + t.dx;
          const ty = y + t.dy;
          if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
          const targetLinear = ty * W + tx;
          if (visited[targetLinear]) continue;
          const ti = targetLinear * 4;
          const w = t.weight * scale;
          errBuf[ti] = readF32(errBuf, ti) + er * w;
          errBuf[ti + 1] = readF32(errBuf, ti + 1) + eg * w;
          errBuf[ti + 2] = readF32(errBuf, ti + 2) + eb * w;
        }
      }
    } else {
    for (let y = 0; y < H; y += 1) {
      // Pick scan direction for this row. Random/Bit-reverse give a stable
      // per-row direction (deterministic across frames so animation doesn't flicker).
      let reverse: boolean;
      if (!serpentine) {
        reverse = false;
      } else if (rowAlt === ROW_ALT.RANDOM) {
        reverse = (((y * 2654435761) >>> 0) & 1) === 1;
      } else if (rowAlt === ROW_ALT.BITREVERSE) {
        reverse = bitReverseParity(y, H) === 1;
      } else if (rowAlt === ROW_ALT.GRAYCODE) {
        reverse = ((y ^ (y >> 1)) & 1) === 1;
      } else if (rowAlt === ROW_ALT.PRIME) {
        reverse = isPrime(y);
      } else if (rowAlt === ROW_ALT.TRIANGULAR) {
        reverse = (triangularSegment(y) & 1) === 1;
      } else if (rowAlt === ROW_ALT.BLOCK2) {
        reverse = ((y >> 1) & 1) === 1;
      } else if (rowAlt === ROW_ALT.BLOCK3) {
        reverse = (((y / 3) | 0) & 1) === 1;
      } else if (rowAlt === ROW_ALT.BLOCK4) {
        reverse = ((y >> 2) & 1) === 1;
      } else if (rowAlt === ROW_ALT.BLOCK8) {
        reverse = ((y >> 3) & 1) === 1;
      } else if (rowAlt === ROW_ALT.REVERSE) {
        reverse = (y & 1) === 0;
      } else {
        reverse = (y & 1) === 1;
      }
      const xStart = reverse ? W - 1 : 0;
      const xEnd = reverse ? -1 : W;
      const xStep = reverse ? -1 : 1;

      for (let x = xStart; x !== xEnd; x += xStep) {
        const i = (x + W * y) * 4;

        if (useLinear) {
          _pix[0] = readF32(errBuf, i); _pix[1] = readF32(errBuf, i + 1);
          _pix[2] = readF32(errBuf, i + 2); _pix[3] = readF32(errBuf, i + 3);
          const color = linearPaletteGetColor(palette, _pix, palette.options);
          const er = _pix[0] - (color[0] ?? 0);
          const eg = _pix[1] - (color[1] ?? 0);
          const eb = _pix[2] - (color[2] ?? 0);

          linearBuf![i] = color[0] ?? 0;
          linearBuf![i + 1] = color[1] ?? 0;
          linearBuf![i + 2] = color[2] ?? 0;

          for (let h = 0; h < kernelHeight; h += 1) {
            for (let w = 0; w < kernelWidth; w += 1) {
              const weight = errorMatrix.kernel[h]?.[w];
              if (weight == null) continue;
              const kx = reverse ? (kernelWidth - 1 - w) : w;
              const tx = x + (kx + offsetX) * xStep;
              const ty = y + h + offsetY;
              if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
              const ti = (tx + W * ty) * 4;
              errBuf[ti] = readF32(errBuf, ti) + er * weight;
              errBuf[ti + 1] = readF32(errBuf, ti + 1) + eg * weight;
              errBuf[ti + 2] = readF32(errBuf, ti + 2) + eb * weight;
            }
          }
        } else {
          const pr = readF32(errBuf, i), pg = readF32(errBuf, i + 1), pb = readF32(errBuf, i + 2);
          _pix[0] = pr; _pix[1] = pg; _pix[2] = pb; _pix[3] = readF32(errBuf, i + 3);
          const color = (palette.getColor ?? palettes.nearest.getColor)(
            _pix,
            palette.options as { levels: number } | undefined
          );
          fillBufferPixel(buf, i, color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, readU8(buf, i + 3));
          const er = pr - (color[0] ?? 0);
          const eg = pg - (color[1] ?? 0);
          const eb = pb - (color[2] ?? 0);

          for (let h = 0; h < kernelHeight; h += 1) {
            for (let w = 0; w < kernelWidth; w += 1) {
              const weight = errorMatrix.kernel[h]?.[w];
              if (weight == null) continue;
              const kx = reverse ? (kernelWidth - 1 - w) : w;
              const tx = x + (kx + offsetX) * xStep;
              const ty = y + h + offsetY;
              if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
              const ti = (tx + W * ty) * 4;
              errBuf[ti] = readF32(errBuf, ti) + er * weight;
              errBuf[ti + 1] = readF32(errBuf, ti + 1) + eg * weight;
              errBuf[ti + 2] = readF32(errBuf, ti + 2) + eb * weight;
            }
          }
        }
      }
    }
    } // end row-major branch
    } // end !didWasm

    if (!didWasm && useLinear) {
      linearFloatToSrgbBuf(linearBuf!, buf);
    }

    // Untranspose so the canvas receives image-space pixels (and so the
    // prevOutput stored for the next frame is in image space, matching what
    // FilterContext expects).
    const finalBuf = isVertical ? transposeRGBA8(buf, W, H) : buf;

    if (temporalMode === TEMPORAL_MODE.VOTE) {
      const restartedAnimation = frameIndex === 0 && voteLastFrameIndex > 0;
      if (
        voteWidth !== realW ||
        voteHeight !== realH ||
        voteDepth !== voteWindow ||
        restartedAnimation
      ) {
        resetVoteState(realW, realH, voteWindow);
      }
      voteLastFrameIndex = frameIndex;

      voteFrames[voteHead % voteWindow] = new Uint8ClampedArray(finalBuf);
      voteHead += 1;
      const filled = Math.min(voteHead, voteWindow);
      const orderedFrames: Uint8ClampedArray[] = [];
      for (let f = 0; f < filled; f += 1) {
        const frame = voteFrames[((voteHead - filled + f) % voteWindow + voteWindow) % voteWindow];
        if (frame) orderedFrames.push(frame);
      }

      const votedBuf = new Uint8ClampedArray(finalBuf.length);
      for (let i = 0; i < finalBuf.length; i += 4) {
        const color = majorityColorAt(orderedFrames, filled, i);
        votedBuf[i] = (color >>> 24) & 0xff;
        votedBuf[i + 1] = (color >>> 16) & 0xff;
        votedBuf[i + 2] = (color >>> 8) & 0xff;
        votedBuf[i + 3] = color & 0xff;
      }

      outputCtx.putImageData(new ImageData(votedBuf, realW, realH), 0, 0);
      return output;
    }

    outputCtx.putImageData(new ImageData(finalBuf, realW, realH), 0, 0);
    return output;
  };

  return {
    name,
    func: filter,
    optionTypes,
    options: defaults,
    defaults: defaultOptions,
    // Reads _prevOutput when temporalBleed > 0 — must run on main thread
    // so the temporal pipeline state is available.
    mainThread: true,
    // Error diffusion pushes quantisation error forward into neighbours that
    // haven't been processed yet — a strict sequential dependency. Fragment
    // shaders are gather-only and fully parallel, so this algorithm can't be
    // expressed in GL without changing its output. Use the Ordered filter for
    // the parallel-dithering equivalent.
    noGL: "error diffusion is sequential (each pixel's output feeds errors forward); GL is gather-only. Use Ordered for parallel dithering.",
  };
};

export default errorDiffusingFilter;
