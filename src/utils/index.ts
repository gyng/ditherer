import {
  RGB_NEAREST,
  RGB_APPROX,
  HSV_NEAREST,
  LAB_NEAREST,
} from "constants/color";

// --- sRGB ↔ linear conversion (float precision) ---

// LUT: sRGB 0-255 → linear float 0.0-1.0
const SRGB_TO_LINEAR_F = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR_F[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// Linear float → sRGB 0-255
const linearFloatToSrgb = (l: number) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, s)) * 255);
};

// Convert sRGB Uint8 buffer → Float32Array in linear 0.0-1.0 range
export const srgbBufToLinearFloat = (buf: Uint8ClampedArray | Uint8Array) => {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = SRGB_TO_LINEAR_F[buf[i] ?? 0] ?? 0;
    out[i + 1] = SRGB_TO_LINEAR_F[buf[i + 1] ?? 0] ?? 0;
    out[i + 2] = SRGB_TO_LINEAR_F[buf[i + 2] ?? 0] ?? 0;
    out[i + 3] = (buf[i + 3] ?? 0) / 255;
  }
  return out;
};

// Convert linear Float32Array → sRGB Uint8ClampedArray
export const linearFloatToSrgbBuf = (
  floats: Float32Array,
  out: Uint8ClampedArray | Uint8Array
) => {
  for (let i = 0; i < floats.length; i += 4) {
    out[i] = linearFloatToSrgb(floats[i] ?? 0);
    out[i + 1] = linearFloatToSrgb(floats[i + 1] ?? 0);
    out[i + 2] = linearFloatToSrgb(floats[i + 2] ?? 0);
    out[i + 3] = Math.round(Math.max(0, Math.min(1, floats[i + 3] ?? 0)) * 255);
  }
};

// Scratch buffers for linearize/delinearize — avoids per-pixel allocations.
// Safe because callers consume return values immediately in the hot loop.
const _linOut: [number, number, number, number] = [0, 0, 0, 0];
const _delinOut: [number, number, number, number] = [0, 0, 0, 0];

// Single-color: sRGB [0-255] → linear float [0-1]
export const linearizeColorF = (c: RgbaLike) => {
  _linOut[0] = SRGB_TO_LINEAR_F[readValue(c, 0)] ?? 0;
  _linOut[1] = SRGB_TO_LINEAR_F[readValue(c, 1)] ?? 0;
  _linOut[2] = SRGB_TO_LINEAR_F[readValue(c, 2)] ?? 0;
  _linOut[3] = readValue(c, 3) / 255;
  return _linOut;
};

// Single-color: linear float [0-1] → sRGB [0-255]
export const delinearizeColorF = (c: RgbaLike) => {
  _delinOut[0] = linearFloatToSrgb(readValue(c, 0));
  _delinOut[1] = linearFloatToSrgb(readValue(c, 1));
  _delinOut[2] = linearFloatToSrgb(readValue(c, 2));
  _delinOut[3] = Math.round(Math.max(0, Math.min(1, readValue(c, 3))) * 255);
  return _delinOut;
};

// --- Legacy 8-bit linearize (kept for simple filters) ---
const SRGB_TO_LINEAR_Q = new Uint8Array(256);
export const LINEAR_TO_SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR_Q[i] = Math.round((SRGB_TO_LINEAR_F[i] ?? 0) * 255);
{
  const buckets = Array.from({ length: 256 }, (): number[] => []);
  for (let i = 0; i < 256; i++) buckets[SRGB_TO_LINEAR_Q[i] ?? 0]?.push(i);
  for (let q = 0; q < 256; q++) {
    const b = buckets[q] ?? [];
    LINEAR_TO_SRGB[q] = b.length > 0 ? (b[Math.floor(b.length / 2)] ?? 0) : 0;
  }
  if (LINEAR_TO_SRGB.length > 0) LINEAR_TO_SRGB[0] = 0;
  if (LINEAR_TO_SRGB.length > 255) LINEAR_TO_SRGB[255] = 255;
}

export const linearizeBuffer = (buf: NumericBuffer) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = SRGB_TO_LINEAR_Q[buf[i] ?? 0] ?? 0;
    buf[i + 1] = SRGB_TO_LINEAR_Q[buf[i + 1] ?? 0] ?? 0;
    buf[i + 2] = SRGB_TO_LINEAR_Q[buf[i + 2] ?? 0] ?? 0;
  }
};

export const delinearizeBuffer = (buf: NumericBuffer) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = LINEAR_TO_SRGB[buf[i] ?? 0] ?? 0;
    buf[i + 1] = LINEAR_TO_SRGB[buf[i + 1] ?? 0] ?? 0;
    buf[i + 2] = LINEAR_TO_SRGB[buf[i + 2] ?? 0] ?? 0;
  }
};

// --- Branded pixel types ---
//
// Prevents mixing up sRGB [0-255] and linear [0-1] pixel data at the type
// level. Filters that work in sRGB space use SrgbPixel + srgbPaletteGetColor.
// Filters with a linear branch use LinearPixel + linearPaletteGetColor.
// The brands are zero-cost at runtime — they only exist for the type checker.

/** Pixel in sRGB space, channels 0-255. Alias for documentation; use
 *  srgbPaletteGetColor with this type. */
export type SrgbPixel = number[];

/** Pixel in linear-light space, channels 0.0-1.0. Alias for documentation;
 *  use linearPaletteGetColor with this type. */
export type LinearPixel = number[];
type NumericBuffer = { [index: number]: number; length: number };
type RgbaLike = readonly number[];
const readValue = (buf: NumericBuffer | RgbaLike, index: number) => buf[index] ?? 0;
const readPixel = (buf: NumericBuffer | RgbaLike, offset = 0): [number, number, number, number] => [
  readValue(buf, offset),
  readValue(buf, offset + 1),
  readValue(buf, offset + 2),
  readValue(buf, offset + 3),
];
const readPaletteColor = (palette: readonly RgbaLike[] | number[][], index: number): [number, number, number, number] =>
  readPixel(palette[index] ?? [], 0);

// --- Palette color matching ---

// For filters that work in sRGB [0-255] space. No isLinear parameter —
// impossible to accidentally request linear conversion.
export const srgbPaletteGetColor = (palette: any, pixel: SrgbPixel, options: any) =>
  palette.getColor(pixel, options);

// For filters that have done their own sRGB→linear conversion and are
// working in linear float [0-1] space. Converts pixel to sRGB for palette
// matching, then converts the matched color back to linear.
export const linearPaletteGetColor = (palette: any, pixel: LinearPixel, options: any) => {
  const srgbPixel = delinearizeColorF(pixel);
  const match = palette.getColor(srgbPixel, options);
  return linearizeColorF(match);
};

// @deprecated — Use srgbPaletteGetColor or linearPaletteGetColor instead.
// This function accepts a boolean isLinear which is the root cause of the
// transparent-output bug. Kept only for pre-existing filters (jitter,
// scanline, channelSeparation, pixelsort, rgbstripe) that still pass
// options._linearize and need to be migrated.
export const paletteGetColor = (
  palette: any,
  pixel: RgbaLike,
  options: any,
  isLinear: boolean
) => {
  if (!isLinear) return palette.getColor(pixel, options);
  const srgbPixel = delinearizeColorF(pixel);
  const match = palette.getColor(srgbPixel, options);
  return linearizeColorF(match);
};

// Memoize a color conversion fn(rgba, ref?) by packing RGBA into a numeric key.
// Avoids ...args rest param (allocates per call) and double Map lookup.
const memoize = (fn: any) => {
  const cache = new Map<number, any>();
  return (input: RgbaLike, ref?: any): any => {
    const key = (readValue(input, 0) << 24 | readValue(input, 1) << 16 | readValue(input, 2) << 8 | readValue(input, 3)) >>> 0;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = fn(input, ref);
    cache.set(key, result);
    return result;
  };
};

// Synchronous readiness flag — callers on the WASM fast path should check this
// before calling WASM functions, since module init is async.
let wasmLoadedFlag = false;
export const wasmIsLoaded = () => wasmLoadedFlag;

// Wire up the inner function references once the module has been initialised.
// Extracted so `initWasmFromBinary` (Node/tooling path) can reuse the same wiring.
const bindWasmModule = (mod: typeof import("wasm/rgba2laba/wasm/rgba2laba")) => {
  wasmRgba2labaInner = mod.rgba2laba;
  wasmRgbaLabaDistanceInner = mod.rgba_laba_distance;
  wasmNearestLabIndexInner = mod.rgba_nearest_lab_index;
  wasmNearestLabPrecomputedInner = mod.nearest_lab_precomputed;
  wasmQuantizeBufferLabInner = mod.quantize_buffer_lab;
  wasmQuantizeBufferRgbInner = mod.quantize_buffer_rgb;
  wasmQuantizeBufferRgbApproxInner = mod.quantize_buffer_rgb_approx;
  wasmQuantizeBufferHsvInner = mod.quantize_buffer_hsv;
  wasmErrorDiffuseBufferInner = mod.error_diffuse_buffer;
  wasmErrorDiffuseCustomInner = mod.error_diffuse_custom_order;
  wasmOrderedDitherLinearInner = mod.ordered_dither_linear_buffer;
  wasmApplyChannelLutInner = mod.apply_channel_lut;
  wasmHsvShiftInner = mod.hsv_shift_buffer;
  wasmGrainMergeInner = mod.grain_merge_buffer;
  wasmMedianFilterInner = mod.median_filter_buffer;
  wasmAnimeColorGradeInner = mod.anime_color_grade_buffer;
  wasmGaussianBlurInner = mod.gaussian_blur_buffer;
  wasmBloomInner = mod.bloom_buffer;
  wasmTriangleDitherInner = mod.triangle_dither_buffer;
  wasmScanlineWarpInner = mod.scanline_warp_buffer;
  wasmVintageTvInner = mod.vintage_tv_buffer;
  wasmRgbStripeInner = mod.rgbstripe_buffer;
  wasmFacetInner = mod.facet_buffer;
  wasmLcdDisplayInner = mod.lcd_display_buffer;
  wasmOilPaintingInner = mod.oil_painting_buffer;
  wasmLensDistortionInner = mod.lens_distortion_buffer;
  wasmTiltShiftInner = mod.tilt_shift_buffer;
  wasmLoadedFlag = true;
};

export const wasmReady: Promise<boolean> = import.meta.env.MODE !== "test"
  ? import("wasm/rgba2laba/wasm/rgba2laba").then(async (mod) => {
    await mod.default();
    bindWasmModule(mod);
    return true;
  }).catch(err => {
    console.error("WASM module failed to load, using JS fallback:", err);
    return false;
  })
  : Promise.resolve(false);

// Node/tooling escape hatch: the default wasmReady path uses `fetch(new URL(...))`
// which Node's undici can't handle for `file://` wasm URLs. Tooling (the gallery
// script) can read the .wasm binary from disk itself and call this to get the
// full WASM-accelerated code paths.
export const initWasmFromBinary = async (binary: BufferSource): Promise<boolean> => {
  try {
    const mod = await import("wasm/rgba2laba/wasm/rgba2laba");
    // Pass the raw binary as the module_or_path param — wasm-bindgen's init
    // accepts a BufferSource directly (skips the fetch path).
    await mod.default(binary as unknown as Parameters<typeof mod.default>[0]);
    bindWasmModule(mod);
    return true;
  } catch (err) {
    console.error("initWasmFromBinary failed:", err);
    return false;
  }
};

export const serializeState = (state: unknown) => JSON.stringify(state);

/**
 * Create a 2D canvas pre-tagged for frequent readback.
 *
 * Any canvas that gets `getImageData` called on it more than once per frame
 * (the full filter pipeline reads its input canvas every filter, every frame)
 * should be created through this helper. The browser otherwise keeps the
 * backing store on the GPU and pays an expensive readback on each call, and
 * warns about it in the console.
 *
 * NOTE: `willReadFrequently` can only be honoured if it is set on the very
 * first `getContext("2d")` call for a given canvas — retrofitting an existing
 * canvas doesn't work, so prefer this helper at canvas creation time.
 */
export const createReadbackCanvas = (width = 0, height = 0): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  if (width > 0) canvas.width = width;
  if (height > 0) canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true });
  return canvas;
};

export const getReadbackContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null =>
  canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;

// sRGB linearization for gamma-correct luminance
const linearize = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

// https://stackoverflow.com/questions/596216/formula-to-determine-brightness-of-rgb-color
export const luminanceItuBt709 = (
  c: RgbaLike,
  linear = true
) => {
  const [cr, cg, cb, ca] = readPixel(c);
  const [r, g, b] = linear
    ? [linearize(cr), linearize(cg), linearize(cb)]
    : [cr / 255, cg / 255, cb / 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) * ca;
};

// ITU BT.601
export const luminance = (
  c: RgbaLike,
  linear = true
) => {
  const [cr, cg, cb, ca] = readPixel(c);
  const [r, g, b] = linear
    ? [linearize(cr), linearize(cg), linearize(cb)]
    : [cr / 255, cg / 255, cb / 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) * ca;
};

export const quantizeValue = (value: number, levels: number) => {
  const step = 255 / (levels - 1);
  const bucket = Math.round(value / step);
  return Math.round(bucket * step);
};

export const clamp = (min: number, max: number, value: number) =>
  Math.max(min, Math.min(max, value));

export const rgba = (r: number, g: number, b: number, a: number) => [
  r,
  g,
  b,
  a
] as [number, number, number, number];

// mutates input
export const equalize = (
  input: NumericBuffer
) => {
  let min = input[0] ?? 0;
  let max = input[0] ?? 0;

  for (let i = 1; i < input.length; i += 1) {
    const val = input[i] ?? 0;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const range = max - min;
  const factor = 256 / range;

  for (let i = 0; i < input.length; i += 1) {
    input[i] = ((input[i] ?? 0) - min) * factor;
  }
};

// http://www.easyrgb.com/en/math.php#text1
export const referenceTable = {
  CIE_1931: {
    // 2° (CIE 1931)
    D65: { x: 95.047, y: 100, z: 108.883 }
  },
  CIE_1964: {
    // 10° (CIE 1964)
    D65: { x: 94.811, y: 100, z: 107.304 }
  }
};

// 0-360, 0-1, 0-1, 0-1
export const rgba2hsva = (input: RgbaLike) => {
  const [ir, ig, ib, ia] = readPixel(input);
  const r = ir / 255;
  const g = ig / 255;
  const b = ib / 255;
  const a = ia / 255;

  let h;
  let s;

  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const delta = max - min;

  const v = max;

  if (delta > 0) {
    s = delta / max;
  } else {
    s = 0;
    h = 0;
    return [h, s, v, a];
  }

  if (r === max) {
    h = (g - b) / delta;
  } else if (g === max) {
    h = 2 + (b - r) / delta;
  } else {
    h = 4 + (r - g) / delta;
  }

  h *= 60;

  if (h < 0) {
    h += 360;
  }

  return [h, s, v, a];
};

// https://stackoverflow.com/questions/7880264/convert-lab-color-to-rgb
// Convert RGB > XYZ > CIE Lab, copying alpha channel
export const rgba2laba = (
  input: RgbaLike,
  ref = referenceTable.CIE_1931.D65
) => {
  const [ir, ig, ib, ia] = readPixel(input);
  // Use pre-computed sRGB→linear LUT instead of 3× pow(2.4)
  const r = (SRGB_TO_LINEAR_F[ir] ?? 0) * 100;
  const g = (SRGB_TO_LINEAR_F[ig] ?? 0) * 100;
  const b = (SRGB_TO_LINEAR_F[ib] ?? 0) * 100;

  // Observer= 2° (Only use CIE 1931!)
  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;

  x /= ref.x;
  y /= ref.y;
  z /= ref.z;

  x = x > 0.008856 ? x ** (1 / 3) : x * 7.787 + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : y * 7.787 + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : z * 7.787 + 16 / 116;

  const outL = 116 * y - 16;
  const outA = 500 * (x - y);
  const outB = 200 * (y - z);

  return [outL, outA, outB, ia];
};

type WasmRgba2LabaFn = (
  r: number,
  g: number,
  b: number,
  a: number,
  refX: number,
  refY: number,
  refZ: number,
) => ArrayLike<number>;
type WasmDistanceFn = (
  ar: number,
  ag: number,
  ab: number,
  aa: number,
  br: number,
  bg: number,
  bb: number,
  ba: number,
  refX: number,
  refY: number,
  refZ: number,
) => number;
type WasmNearestLabIndexFn = (
  r: number,
  g: number,
  b: number,
  a: number,
  palette: Float64Array,
  refX: number,
  refY: number,
  refZ: number,
) => number;
type WasmNearestLabPrecomputedFn = (
  r: number,
  g: number,
  b: number,
  paletteLab: Float64Array,
  refX: number,
  refY: number,
  refZ: number,
) => number;
type WasmQuantizeBufferFn = {
  bivarianceHack(
    buffer: Uint8Array | Uint8ClampedArray,
    palette: Float64Array,
    refX?: number,
    refY?: number,
    refZ?: number,
  ): Uint8Array<ArrayBufferLike>;
}["bivarianceHack"];
type WasmGaussianBlurFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    sigma: number,
  ): void;
}["bivarianceHack"];
type WasmBloomFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    threshold: number,
    strength: number,
    radius: number,
  ): void;
}["bivarianceHack"];
type WasmAnimeColorGradeFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    shadowCool: number,
    highlightWarm: number,
    blackPoint: number,
    whitePoint: number,
    contrast: number,
    midtoneLift: number,
    vibrance: number,
    mix: number,
  ): void;
}["bivarianceHack"];
type WasmMedianFilterFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
  ): void;
}["bivarianceHack"];
type WasmGrainMergeFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
    strength: number,
  ): void;
}["bivarianceHack"];
type WasmOilPaintingFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
    levels: number,
  ): void;
}["bivarianceHack"];
type WasmLensDistortionFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    k1: number,
    k2: number,
    zoom: number,
  ): void;
}["bivarianceHack"];
type WasmTiltShiftFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    focusPosition: number,
    focusWidth: number,
    blurAmount: number,
    saturationBoost: number,
  ): void;
}["bivarianceHack"];
type WasmVintageTvFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    banding: number,
    colorFringe: number,
    rollOffset: number,
    frameIndex: number,
    glow: number,
  ): void;
}["bivarianceHack"];
type WasmFacetFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    facetSize: number,
    jitter: number,
    seamWidth: number,
    lineR: number,
    lineG: number,
    lineB: number,
    fillMode: number,
    paletteLevels: number,
  ): void;
}["bivarianceHack"];
type WasmRgbStripeFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    prevOutput: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    mask: Float64Array,
    maskW: number,
    maskH: number,
    brightness: number,
    contrast: number,
    exposure: number,
    gamma: number,
    phosphorScale: number,
    scanlineGap: number,
    scanlineStrength: number,
    includeScanline: number,
    misconvergence: number,
    beamSpread: number,
    bloom: number,
    bloomThreshold: number,
    bloomRadius: number,
    bloomStrength: number,
    curvature: number,
    vignette: number,
    interlace: number,
    interlaceField: number,
    persistence: number,
    flicker: number,
    frameIndex: number,
    degaussFrame: number,
    paletteLevels: number,
  ): void;
}["bivarianceHack"];
type WasmScanlineWarpFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    amplitude: number,
    frequency: number,
    phaseRad: number,
    animOffset: number,
  ): void;
}["bivarianceHack"];
type WasmLcdDisplayFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    pixelSize: number,
    subpixelLayout: number,
    brightness: number,
    gapDarkness: number,
  ): void;
}["bivarianceHack"];
type WasmTriangleDitherFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    levels: number,
    seed: number,
    paletteMode: number,
    palette: Float64Array,
    refX: number,
    refY: number,
    refZ: number,
  ): void;
}["bivarianceHack"];
type WasmHsvShiftFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    hueShift: number,
    satShift: number,
    valShift: number,
  ): void;
}["bivarianceHack"];
type WasmApplyChannelLutFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    lutR: Uint8Array,
    lutG: Uint8Array,
    lutB: Uint8Array,
  ): void;
}["bivarianceHack"];
type WasmOrderedDitherLinearFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    thresholdMap: Float64Array,
    thresholdW: number,
    thresholdH: number,
    temporalOx: number,
    temporalOy: number,
    orderedLevels: number,
    paletteMode: number,
    levels: number,
    palette: Float64Array,
    refX: number,
    refY: number,
    refZ: number,
  ): void;
}["bivarianceHack"];
type WasmErrorDiffuseCustomFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    visitOrder: Uint32Array,
    tuples: Float32Array,
    kernelStarts: Uint32Array,
    kernelLens: Uint32Array,
    kernelTotals: Float32Array,
    errStrategy: number,
    linearize: boolean,
    prevInput: Uint8Array | Uint8ClampedArray,
    prevOutput: Uint8Array | Uint8ClampedArray,
    temporalBleed: number,
    paletteMode: number,
    levels: number,
    palette: Float64Array,
    refX: number,
    refY: number,
    refZ: number,
  ): void;
}["bivarianceHack"];
type WasmErrorDiffuseBufferFn = {
  bivarianceHack(
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    kernel: Float64Array,
    kernelWidth: number,
    kernelHeight: number,
    offsetX: number,
    offsetY: number,
    serpentine: boolean,
    rowAlt: number,
    linearize: boolean,
    prevInput: Uint8Array | Uint8ClampedArray,
    prevOutput: Uint8Array | Uint8ClampedArray,
    temporalBleed: number,
    paletteMode: number,
    levels: number,
    palette: Float64Array,
    refX: number,
    refY: number,
    refZ: number,
  ): void;
}["bivarianceHack"];

let wasmRgba2labaInner: WasmRgba2LabaFn = (a, b, c, d, e, f, g) => {
  console.error("WASM module not loaded!", a, b, c, d, e, f, g);
  return [0, 0, 0, 0];
};

let wasmRgbaLabaDistanceInner: WasmDistanceFn = (a, b, c, d, e, f, g, h, i, j, k) => {
  console.error("WASM module not loaded!", a, b, c, d, e, f, g, h, i, j, k);
  return 0;
};

let wasmNearestLabIndexInner: WasmNearestLabIndexFn = (_r, _g, _b, _a, _palette, _rx, _ry, _rz) => {
  console.error("WASM module not loaded!");
  return 0;
};

let wasmNearestLabPrecomputedInner: WasmNearestLabPrecomputedFn = (_r, _g, _b, _palette_lab, _rx, _ry, _rz) => {
  console.error("WASM module not loaded!");
  return 0;
};

let wasmQuantizeBufferLabInner: WasmQuantizeBufferFn = (_buffer, _palette, _rx, _ry, _rz) => {
  console.error("WASM module not loaded!");
  return new Uint8Array(0);
};

let wasmQuantizeBufferRgbInner: WasmQuantizeBufferFn = (_buffer, _palette) => {
  console.error("WASM module not loaded!");
  return new Uint8Array(0);
};

let wasmQuantizeBufferRgbApproxInner: WasmQuantizeBufferFn = (_buffer, _palette) => {
  console.error("WASM module not loaded!");
  return new Uint8Array(0);
};

let wasmQuantizeBufferHsvInner: WasmQuantizeBufferFn = (_buffer, _palette) => {
  console.error("WASM module not loaded!");
  return new Uint8Array(0);
};

let wasmErrorDiffuseBufferInner: WasmErrorDiffuseBufferFn = () => {
  console.error("WASM module not loaded!");
  return new Uint8Array(0);
};

let wasmErrorDiffuseCustomInner: WasmErrorDiffuseCustomFn = () => {
  console.error("WASM module not loaded!");
};

let wasmOrderedDitherLinearInner: WasmOrderedDitherLinearFn = () => {
  console.error("WASM module not loaded!");
};

let wasmApplyChannelLutInner: WasmApplyChannelLutFn = () => {
  console.error("WASM module not loaded!");
};

let wasmHsvShiftInner: WasmHsvShiftFn = () => {
  console.error("WASM module not loaded!");
};

let wasmTriangleDitherInner: WasmTriangleDitherFn = () => {
  console.error("WASM module not loaded!");
};

let wasmOilPaintingInner: WasmOilPaintingFn = () => {
  console.error("WASM module not loaded!");
};

let wasmLensDistortionInner: WasmLensDistortionFn = () => {
  console.error("WASM module not loaded!");
};

let wasmTiltShiftInner: WasmTiltShiftFn = () => {
  console.error("WASM module not loaded!");
};

let wasmVintageTvInner: WasmVintageTvFn = () => {
  console.error("WASM module not loaded!");
};

let wasmRgbStripeInner: WasmRgbStripeFn = () => {
  console.error("WASM module not loaded!");
};

let wasmFacetInner: WasmFacetFn = () => {
  console.error("WASM module not loaded!");
};

let wasmScanlineWarpInner: WasmScanlineWarpFn = () => {
  console.error("WASM module not loaded!");
};

let wasmLcdDisplayInner: WasmLcdDisplayFn = () => {
  console.error("WASM module not loaded!");
};

let wasmGrainMergeInner: WasmGrainMergeFn = () => {
  console.error("WASM module not loaded!");
};

let wasmMedianFilterInner: WasmMedianFilterFn = () => {
  console.error("WASM module not loaded!");
};

let wasmAnimeColorGradeInner: WasmAnimeColorGradeFn = () => {
  console.error("WASM module not loaded!");
};

let wasmGaussianBlurInner: WasmGaussianBlurFn = () => {
  console.error("WASM module not loaded!");
};

let wasmBloomInner: WasmBloomFn = () => {
  console.error("WASM module not loaded!");
};


export const wasmRgbaLabaDistance = (
  a: RgbaLike,
  b: RgbaLike,
  ref = referenceTable.CIE_1931.D65
) =>
  wasmRgbaLabaDistanceInner(
    readValue(a, 0),
    readValue(a, 1),
    readValue(a, 2),
    readValue(a, 3),
    readValue(b, 0),
    readValue(b, 1),
    readValue(b, 2),
    readValue(b, 3),
    ref.x,
    ref.y,
    ref.z
  );

export const wasmRgba2laba = (
  input: RgbaLike,
  ref = referenceTable.CIE_1931.D65
) =>
  wasmRgba2labaInner(
    readValue(input, 0),
    readValue(input, 1),
    readValue(input, 2),
    readValue(input, 3),
    ref.x,
    ref.y,
    ref.z
  );

export const wasmRgba2labaMemo = memoize(wasmRgba2laba);
export const rgba2labaMemo = memoize(rgba2laba);
export const rgba2hsvaMemo = memoize(rgba2hsva);

// Batch nearest-colour search in WASM — one JS/WASM crossing per pixel
// instead of O(palette_size). Palette is cached as a flat Float64Array.
let cachedPaletteFlat: Float64Array | null = null;
let cachedPaletteRef: readonly RgbaLike[] | null = null;
export const wasmNearestLabIndex = (
  pixel: RgbaLike,
  palette: readonly RgbaLike[],
  ref = referenceTable.CIE_1931.D65
) => {
  if (cachedPaletteRef !== palette) {
    cachedPaletteFlat = new Float64Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b, a] = readPaletteColor(palette, i);
      cachedPaletteFlat[i * 4] = r;
      cachedPaletteFlat[i * 4 + 1] = g;
      cachedPaletteFlat[i * 4 + 2] = b;
      cachedPaletteFlat[i * 4 + 3] = a;
    }
    cachedPaletteRef = palette;
  }
  return wasmNearestLabIndexInner(
    readValue(pixel, 0), readValue(pixel, 1), readValue(pixel, 2), readValue(pixel, 3),
    cachedPaletteFlat!,
    ref.x, ref.y, ref.z
  );
};

// Per-pixel nearest with pre-converted Lab palette — avoids re-converting
// palette to Lab on every pixel. Palette Lab is cached alongside the RGBA cache.
let cachedPaletteLabFlat: Float64Array | null = null;
let cachedPaletteLabRef: readonly RgbaLike[] | null = null;
export const wasmNearestLabPrecomputed = (
  pixel: number[],
  palette: number[][],
  ref = referenceTable.CIE_1931.D65
) => {
  if (cachedPaletteLabRef !== palette) {
    // Pre-convert palette to Lab on JS side, cache as flat [L,a,b, L,a,b, …]
    cachedPaletteLabFlat = new Float64Array(palette.length * 3);
    for (let i = 0; i < palette.length; i++) {
      const lab = rgba2laba(readPaletteColor(palette, i));
      cachedPaletteLabFlat[i * 3] = lab[0] ?? 0;
      cachedPaletteLabFlat[i * 3 + 1] = lab[1] ?? 0;
      cachedPaletteLabFlat[i * 3 + 2] = lab[2] ?? 0;
    }
    cachedPaletteLabRef = palette;
  }
  return wasmNearestLabPrecomputedInner(
    readValue(pixel, 0), readValue(pixel, 1), readValue(pixel, 2),
    cachedPaletteLabFlat!,
    ref.x, ref.y, ref.z
  );
};

// Quantize an entire u8 RGBA buffer in a single WASM call.
// Palette is cached as a flat Float64Array.
export const wasmQuantizeBufferLab = (
  buffer: Uint8ClampedArray | Uint8Array,
  palette: number[][],
  ref = referenceTable.CIE_1931.D65
): Uint8Array =>
  wasmQuantizeBufferLabInner(buffer, ensurePaletteFlat(palette), ref.x, ref.y, ref.z);

// Helper: ensure cached palette flat is fresh
const ensurePaletteFlat = (palette: number[][]) => {
  if (cachedPaletteRef !== palette) {
    cachedPaletteFlat = new Float64Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b, a] = readPaletteColor(palette, i);
      cachedPaletteFlat[i * 4] = r;
      cachedPaletteFlat[i * 4 + 1] = g;
      cachedPaletteFlat[i * 4 + 2] = b;
      cachedPaletteFlat[i * 4 + 3] = a;
    }
    cachedPaletteRef = palette;
  }
  return cachedPaletteFlat!;
};

export const wasmQuantizeBufferRgb = (
  buffer: Uint8ClampedArray | Uint8Array,
  palette: number[][],
): Uint8Array =>
  wasmQuantizeBufferRgbInner(buffer, ensurePaletteFlat(palette));

export const wasmQuantizeBufferRgbApprox = (
  buffer: Uint8ClampedArray | Uint8Array,
  palette: number[][],
): Uint8Array =>
  wasmQuantizeBufferRgbApproxInner(buffer, ensurePaletteFlat(palette));

export const wasmQuantizeBufferHsv = (
  buffer: Uint8ClampedArray | Uint8Array,
  palette: number[][],
): Uint8Array =>
  wasmQuantizeBufferHsvInner(buffer, ensurePaletteFlat(palette));

// Resolve the colorDistanceAlgorithm for a palette, honoring the user palette's
// runtime fallback (defaults.colorDistanceAlgorithm) so random-preset palettes
// — which only carry `colors` in options — still take the WASM fast path.
export const resolvePaletteColorAlgorithm = (palette: unknown): string | null => {
  const p = palette as { options?: { colorDistanceAlgorithm?: string }; defaults?: { colorDistanceAlgorithm?: string } } | null | undefined;
  return p?.options?.colorDistanceAlgorithm ?? p?.defaults?.colorDistanceAlgorithm ?? null;
};

// One-shot console.info dispatcher used by filters to surface their WASM/JS
// routing decisions. Keyed on (filter, status, reason) so it fires once per
// distinct outcome instead of every frame. We also track the most recent
// status per filter in `filterLastStatus` for tools (the gallery benchmark)
// that want to report which path was actually taken.
export type FilterWasmStatus = { didWasm: boolean; reason: string };
const filterWasmStatusLogged = new Set<string>();
const filterNamesLogged = new Set<string>();
const filterLastStatus = new Map<string, FilterWasmStatus>();

export const logFilterWasmStatus = (filterName: string, didWasm: boolean, reason: string) => {
  filterNamesLogged.add(filterName);
  filterLastStatus.set(filterName, { didWasm, reason });
  const key = `${filterName}|${didWasm}|${reason}`;
  if (filterWasmStatusLogged.has(key)) return;
  filterWasmStatusLogged.add(key);
  console.info(`[filter:${filterName}] ${didWasm ? "WASM" : "JS"} (${reason})`);
};

// Like logFilterWasmStatus but lets the caller label the backend explicitly
// (e.g., "WebGL2"). Useful when a filter has more than two code paths. Flags
// didWasm=true in the status map so audit tools count GL as "not pure JS".
export const logFilterBackend = (filterName: string, backend: string, reason: string) => {
  filterNamesLogged.add(filterName);
  filterLastStatus.set(filterName, { didWasm: true, reason: `${backend} ${reason}` });
  const key = `${filterName}|${backend}|${reason}`;
  if (filterWasmStatusLogged.has(key)) return;
  filterWasmStatusLogged.add(key);
  console.info(`[filter:${filterName}] ${backend} (${reason})`);
};

// Called from the filter dispatcher once per frame per filter. If the filter
// has never self-reported via logFilterWasmStatus, we record a one-shot
// "JS (no wasm path)" — useful for auditing which filters are candidates
// for Rust/WASM porting. Filters that DO self-report (Ordered, Quantize,
// error diffusion etc.) suppress this fallback.
export const logFilterDispatched = (filterName: string) => {
  if (filterNamesLogged.has(filterName)) return;
  filterNamesLogged.add(filterName);
  filterLastStatus.set(filterName, { didWasm: false, reason: "no wasm path" });
  console.info(`[filter:${filterName}] JS (no wasm path)`);
};

// Snapshot of the most recently recorded status for each filter. Returns a
// fresh Map so callers can freely mutate/read without disturbing internal state.
export const getFilterWasmStatuses = (): Map<string, FilterWasmStatus> =>
  new Map(filterLastStatus);

// Drop any recorded status for the named filter. Useful for the gallery's
// per-filter benchmark which needs a clean slate before each measurement.
export const resetFilterWasmStatus = (filterName: string) => {
  filterLastStatus.delete(filterName);
};

// Palette mode IDs — must match PAL_MODE_* in src/wasm/rgba2laba/src/lib.rs.
export const WASM_PALETTE_MODE = {
  LEVELS: 0,
  RGB: 1,
  RGB_APPROX: 2,
  HSV: 3,
  LAB: 4,
} as const;

// Map a colorDistanceAlgorithm string to the WASM palette mode, or null if unsupported.
export const colorAlgorithmToWasmMode = (algo: string | undefined): number | null => {
  switch (algo) {
    case RGB_NEAREST: return WASM_PALETTE_MODE.RGB;
    case RGB_APPROX: return WASM_PALETTE_MODE.RGB_APPROX;
    case HSV_NEAREST: return WASM_PALETTE_MODE.HSV;
    case LAB_NEAREST: return WASM_PALETTE_MODE.LAB;
    default: return null;
  }
};

// Single-call error-diffusion dithering in WASM. Covers the sRGB horizontal
// serpentine-boustrophedon path (the default Floyd-Steinberg et al.); callers
// must pre-transpose for vertical scans and skip this for custom scan orders,
// linear mode, temporal bleed/vote, or unsupported palettes.
export const wasmErrorDiffuseBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  kernel: Float64Array,
  kernelWidth: number,
  kernelHeight: number,
  offsetX: number,
  offsetY: number,
  serpentine: boolean,
  rowAlt: number,
  linearize: boolean,
  prevInput: Uint8ClampedArray | Uint8Array | null,
  prevOutput: Uint8ClampedArray | Uint8Array | null,
  temporalBleed: number,
  paletteMode: number,
  levels: number,
  palette: number[][] | null,
  ref = referenceTable.CIE_1931.D65,
): void =>
  wasmErrorDiffuseBufferInner(
    input, output, width, height,
    kernel, kernelWidth, kernelHeight, offsetX, offsetY,
    serpentine, rowAlt, linearize,
    prevInput ?? EMPTY_U8,
    prevOutput ?? EMPTY_U8,
    temporalBleed,
    paletteMode, levels,
    palette ? ensurePaletteFlat(palette) : new Float64Array(0),
    ref.x, ref.y, ref.z,
  );

const EMPTY_U8 = new Uint8Array(0);

// Custom-order error diffusion (Hilbert / Spiral / Diagonal / Random Pixel).
// JS builds the visit order and pre-rotated kernels; WASM runs the hot loop.
export const wasmErrorDiffuseCustomOrder = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  visitOrder: Uint32Array,
  tuples: Float32Array,
  kernelStarts: Uint32Array,
  kernelLens: Uint32Array,
  kernelTotals: Float32Array,
  errStrategy: number,
  linearize: boolean,
  prevInput: Uint8ClampedArray | Uint8Array | null,
  prevOutput: Uint8ClampedArray | Uint8Array | null,
  temporalBleed: number,
  paletteMode: number,
  levels: number,
  palette: number[][] | null,
  ref = referenceTable.CIE_1931.D65,
): void =>
  wasmErrorDiffuseCustomInner(
    input, output, width, height,
    visitOrder, tuples, kernelStarts, kernelLens, kernelTotals,
    errStrategy, linearize,
    prevInput ?? EMPTY_U8,
    prevOutput ?? EMPTY_U8,
    temporalBleed,
    paletteMode, levels,
    palette ? ensurePaletteFlat(palette) : new Float64Array(0),
    ref.x, ref.y, ref.z,
  );

// Error-strategy IDs — must match ERR_STRATEGY_* in src/wasm/rgba2laba/src/lib.rs
// and the JS-side ERR_STRATEGY enum in errorDiffusingFilterFactory.ts.
export const WASM_ERR_STRATEGY = {
  RENORMALIZE: 0,
  CLAMPED: 1,
  DROP: 2,
  ROTATE: 3,
  SYMMETRIC: 4,
} as const;

// Row-alternation IDs — must match ROW_ALT_* in src/wasm/rgba2laba/src/lib.rs
// and the JS-side ROW_ALT enum in src/filters/errorDiffusingFilterFactory.ts.
export const WASM_ROW_ALT = {
  BOUSTROPHEDON: 0,
  REVERSE: 1,
  BLOCK2: 2,
  BLOCK3: 3,
  BLOCK4: 4,
  BLOCK8: 5,
  TRIANGULAR: 6,
  GRAYCODE: 7,
  BITREVERSE: 8,
  PRIME: 9,
  RANDOM: 10,
} as const;

// Separable Gaussian blur in a single WASM call (builds the 1D kernel from
// sigma internally, then does horizontal + vertical passes with clamp-to-edge).
export const wasmGaussianBlurBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  sigma: number,
): void => wasmGaussianBlurInner(input, output, width, height, sigma);

// Bloom: threshold bright pixels, separable box blur, additive composite.
// The JS side resolves relative threshold (needs a max-luminance scan) before
// calling — WASM receives the resolved absolute threshold.
export const wasmBloomBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold: number,
  strength: number,
  radius: number,
): void => wasmBloomInner(input, output, width, height, threshold, strength, radius);

// Anime Color Grade — per-pixel tone curve → luminance-weighted cool/warm
// tint → partial luminance restore → vibrance → mix. All in a single WASM
// call so the JS side only has to marshal the 8 scalar option values.
export const wasmAnimeColorGradeBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  shadowCool: number,
  highlightWarm: number,
  blackPoint: number,
  whitePoint: number,
  contrast: number,
  midtoneLift: number,
  vibrance: number,
  mix: number,
): void =>
  wasmAnimeColorGradeInner(input, output, shadowCool, highlightWarm, blackPoint, whitePoint, contrast, midtoneLift, vibrance, mix);

// Median filter with circular neighborhood (dx² + dy² ≤ r²) and clamp-to-edge
// sampling. Used by the Median Filter filter.
export const wasmMedianFilterBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  radius: number,
): void => wasmMedianFilterInner(input, output, width, height, radius);

// Box-blur high-pass + per-pixel mix for the Grain merge filter. Uses an
// integral image internally for O(W*H) total cost regardless of radius.
export const wasmGrainMergeBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  radius: number,
  strength: number,
): void => wasmGrainMergeInner(input, output, width, height, radius, strength);

// Oil Painting: per-pixel histogram-binned-by-luminance averaging over a
// (2r+1)² neighbourhood. Pure per-pixel independent; caller supplies radius
// and bin count.
export const wasmOilPaintingBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  radius: number,
  levels: number,
): void => wasmOilPaintingInner(input, output, width, height, radius, levels);

// Lens distortion: inverse radial distortion with Newton's-method
// per-pixel radius inversion; sample is rounded-nearest. Matches the JS
// path including the out-of-bounds transparent pixel.
export const wasmLensDistortionBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  k1: number,
  k2: number,
  zoom: number,
): void => wasmLensDistortionInner(input, output, width, height, k1, k2, zoom);

// Tilt Shift: separable Gaussian blur then focus-band blend with optional
// saturation boost. All in-line so the blur's f32 intermediate stays in
// scope for the blend (matches the JS path bit-for-bit).
export const wasmTiltShiftBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  focusPosition: number,
  focusWidth: number,
  blurAmount: number,
  saturationBoost: number,
): void => wasmTiltShiftInner(input, output, width, height, focusPosition, focusWidth, blurAmount, saturationBoost);

// Vintage TV: y-rolled sampling with R-channel fringe, per-row sin-driven
// banding, and a conditional highlight glow. Per-row bandVal is cached in
// the Rust function so the hot loop skips redundant `sin` calls.
export const wasmVintageTvBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  banding: number,
  colorFringe: number,
  rollOffset: number,
  frameIndex: number,
  glow: number,
): void => wasmVintageTvInner(input, output, width, height, banding, colorFringe, rollOffset, frameIndex, glow);

// rgbStripe (CRT emulation): full pipeline port — misconvergence pre-pass,
// curvature, degauss warp+hue rotation, RGB shadow-mask multiply, BCG chain,
// scanlines, flicker, vignette, palette quantize (inline), beam spread,
// bloom, persistence. `paletteLevels` sentinel: 0 or ≥256 means no palette,
// 2–255 is nearest quantization applied before the post-passes so they
// operate on the same values as the JS reference pipeline.
export const wasmRgbStripeBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  prevOutput: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  mask: Float64Array,
  maskW: number,
  maskH: number,
  brightness: number,
  contrast: number,
  exposure: number,
  gamma: number,
  phosphorScale: number,
  scanlineGap: number,
  scanlineStrength: number,
  includeScanline: number,
  misconvergence: number,
  beamSpread: number,
  bloom: number,
  bloomThreshold: number,
  bloomRadius: number,
  bloomStrength: number,
  curvature: number,
  vignette: number,
  interlace: number,
  interlaceField: number,
  persistence: number,
  flicker: number,
  frameIndex: number,
  degaussFrame: number,
  paletteLevels: number,
): void => wasmRgbStripeInner(
  input, output, prevOutput, width, height, mask, maskW, maskH,
  brightness, contrast, exposure, gamma,
  phosphorScale, scanlineGap, scanlineStrength, includeScanline,
  misconvergence, beamSpread, bloom, bloomThreshold, bloomRadius, bloomStrength,
  curvature, vignette, interlace, interlaceField,
  persistence, flicker, frameIndex, degaussFrame, paletteLevels,
);

// Facet: Voronoi-ish tessellation with optional seams. The WASM kernel
// uses a 3x3 spatial-grid lookup for nearest-two seeds, dropping the
// inner loop from O(N) to O(9). `fillMode`: 0 = AVERAGE (per-facet mean
// colour), 1 = CENTER (sample at the seed pixel). `paletteLevels`:
// 0/≥256 = identity, 2-255 = inline nearest quantize.
export const FACET_FILL_MODE = { AVERAGE: 0, CENTER: 1 } as const;

export const wasmFacetBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  facetSize: number,
  jitter: number,
  seamWidth: number,
  lineR: number,
  lineG: number,
  lineB: number,
  fillMode: number,
  paletteLevels: number,
): void => wasmFacetInner(
  input, output, width, height,
  facetSize, jitter, seamWidth,
  lineR, lineG, lineB,
  fillMode, paletteLevels,
);

// Scanline Warp: sin-driven per-row horizontal shift with bilinear sampling.
export const wasmScanlineWarpBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  amplitude: number,
  frequency: number,
  phaseRad: number,
  animOffset: number,
): void => wasmScanlineWarpInner(input, output, width, height, amplitude, frequency, phaseRad, animOffset);

// LCD Display subpixel simulation. `subpixelLayout`: 0 = STRIPE, 1 = PENTILE,
// 2 = DIAMOND (must match LCD_SUBPIXEL_LAYOUT).
export const LCD_SUBPIXEL_LAYOUT = { STRIPE: 0, PENTILE: 1, DIAMOND: 2 } as const;

export const wasmLcdDisplayBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  pixelSize: number,
  subpixelLayout: number,
  brightness: number,
  gapDarkness: number,
): void => wasmLcdDisplayInner(input, output, width, height, pixelSize, subpixelLayout, brightness, gapDarkness);

// Triangle dither: TPDF noise added per channel, then either a `levels` snap
// (paletteMode = LEVELS) or a nearest-colour match against `palette` (any of
// the other palette modes). Caller seeds the WASM PRNG with any non-zero u32
// (use Math.random() for JS-like run-to-run variation).
export const wasmTriangleDitherBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  levels: number,
  seed: number,
  paletteMode: number,
  palette: number[][] | null,
  ref = referenceTable.CIE_1931.D65,
): void =>
  wasmTriangleDitherInner(
    input, output, levels, seed,
    paletteMode,
    palette ? ensurePaletteFlat(palette) : new Float64Array(0),
    ref.x, ref.y, ref.z,
  );

// Per-pixel HSV shift (hue in degrees, sat/val in [-1, 1]) applied in a single
// WASM call. Alpha passes through unchanged. Used by the Color shift filter.
export const wasmHsvShiftBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  hueShift: number,
  satShift: number,
  valShift: number,
): void => wasmHsvShiftInner(input, output, hueShift, satShift, valShift);

// Apply three 256-entry per-channel LUTs to an RGBA buffer in a single WASM
// call. The caller is responsible for constructing the LUTs — this just does
// the tight per-pixel dispatch. Used by Curves (RGB/R/G/B modes), Smooth
// Posterize, and any future filter that reduces to a per-channel remap.
export const wasmApplyChannelLut = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  lutR: Uint8Array,
  lutG: Uint8Array,
  lutB: Uint8Array,
): void => wasmApplyChannelLutInner(input, output, lutR, lutG, lutB);

// Linear-mode ordered dither in a single WASM call. Handles the sRGB→linear
// input conversion, threshold-bias quantization in linear space, the linear→sRGB
// roundtrip, and the palette match (LEVELS / RGB / RGB_APPROX / HSV / LAB).
// Keep flattened threshold map as Float64Array to match the JS-side 2D map semantics.
export const wasmOrderedDitherLinearBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  thresholdMap: Float64Array,
  thresholdW: number,
  thresholdH: number,
  temporalOx: number,
  temporalOy: number,
  orderedLevels: number,
  paletteMode: number,
  levels: number,
  palette: number[][] | null,
  ref = referenceTable.CIE_1931.D65,
): void =>
  wasmOrderedDitherLinearInner(
    input, output, width, height,
    thresholdMap, thresholdW, thresholdH, temporalOx, temporalOy,
    orderedLevels, paletteMode, levels,
    palette ? ensurePaletteFlat(palette) : new Float64Array(0),
    ref.x, ref.y, ref.z,
  );

// Convert CIE Lab > XYZ > RGBA, copying alpha channel
// Unified WASM buffer quantize dispatcher — picks the right function based on algorithm.
// Returns a Uint8Array of matched palette colors, or null if no WASM function available.
export const wasmQuantizeBuffer = (
  buffer: Uint8ClampedArray | Uint8Array,
  palette: number[][],
  colorDistanceAlgorithm: string,
  ref = referenceTable.CIE_1931.D65
): Uint8Array | null => {
  switch (colorDistanceAlgorithm) {
    case RGB_NEAREST:
      return wasmQuantizeBufferRgbInner(buffer, ensurePaletteFlat(palette));
    case RGB_APPROX:
      return wasmQuantizeBufferRgbApproxInner(buffer, ensurePaletteFlat(palette));
    case HSV_NEAREST:
      return wasmQuantizeBufferHsvInner(buffer, ensurePaletteFlat(palette));
    case LAB_NEAREST:
      return wasmQuantizeBufferLabInner(buffer, ensurePaletteFlat(palette), ref.x, ref.y, ref.z);
    default:
      return null;
  }
};

export const laba2rgba = (
  input: RgbaLike,
  ref = referenceTable.CIE_1931.D65
) => {
  const [l, a, bIn, alpha] = readPixel(input);
  let y = (l + 16) / 116;
  let x = a / 500 + y;
  let z = y - bIn / 200;

  y = y ** 3 > 0.008856 ? y ** 3 : (y - 16 / 116) / 7.787;
  x = x ** 3 > 0.008856 ? x ** 3 : (x - 16 / 116) / 7.787;
  z = z ** 3 > 0.008856 ? z ** 3 : (z - 16 / 116) / 7.787;

  // Observer= 2° (Only use CIE 1931!)
  x *= ref.x;
  y *= ref.y;
  z *= ref.z;

  // Normalize
  x /= 100;
  y /= 100;
  z /= 100;

  let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let b = x * 0.0557 + y * -0.204 + z * 1.057;

  r = r > 0.0031308 ? 1.055 * r ** (1 / 2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g;
  b = b > 0.0031308 ? 1.055 * b ** (1 / 2.4) - 0.055 : 12.92 * b;

  r = clamp(0, 255, Math.round(r * 255));
  g = clamp(0, 255, Math.round(g * 255));
  b = clamp(0, 255, Math.round(b * 255));

  return [r, g, b, alpha];
};

// a can be assumed to be palette colour.
// Returns squared distance (sqrt omitted — monotone, so comparison ordering
// is preserved and callers only use this for nearest-color search).
export const colorDistance = (
  a: RgbaLike,
  b: RgbaLike,
  colorDistanceAlgorithm: string
) => {
  const [ar, ag, ab] = readPixel(a);
  const [br, bg, bb] = readPixel(b);
  switch (colorDistanceAlgorithm) {
    case RGB_NEAREST:
      return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
    case LAB_NEAREST: {
      const aLab = rgba2labaMemo(a);
      const bLab = rgba2laba(b);
      return ((bLab[0] ?? 0) - (aLab[0] ?? 0)) ** 2 +
        ((bLab[1] ?? 0) - (aLab[1] ?? 0)) ** 2 +
        ((bLab[2] ?? 0) - (aLab[2] ?? 0)) ** 2;
    }
    case RGB_APPROX: {
      const r = (ar + br) / 2;
      const dR = ar - br;
      const dG = ag - bg;
      const dB = ab - bb;

      const dRc = (2 + r / 256) * dR ** 2;
      const dGc = 4 * dG ** 2;
      const dBc = (2 + (255 - r) / 256) * dB ** 2;

      return dRc + dGc + dBc;
    }
    case HSV_NEAREST: {
      const aHsv = rgba2hsva(a);
      const bHsv = rgba2hsva(b);
      const dH =
        Math.min(
          Math.abs((bHsv[0] ?? 0) - (aHsv[0] ?? 0)),
          360 - Math.abs((bHsv[0] ?? 0) - (aHsv[0] ?? 0))
        ) / 180.0;
      const dS = Math.abs((bHsv[1] ?? 0) - (aHsv[1] ?? 0));
      const dV = Math.abs((bHsv[2] ?? 0) - (aHsv[2] ?? 0)) / 255.0;

      return dH ** 2 + dS ** 2 + dV ** 2;
    }
    default:
      return -1;
  }
};

export const medianCutPalette = (
  buf: Uint8ClampedArray | Uint8Array,
  limit: number,
  ignoreAlpha: boolean,
  adaptMode: string,
  colorMode = "RGB"
) => {
  const [firstR, firstG, firstB, firstA] = readPixel(buf);
  const range = {
    r: { min: firstR, max: firstR },
    g: { min: firstG, max: firstG },
    b: { min: firstB, max: firstB },
    a: { min: firstA, max: firstA }
  };

  const pixels: number[][] = [];

  for (let i = 0; i < buf.length; i += 4) {
    const [rawR, rawG, rawB, rawA] = readPixel(buf, i);
    const pixelRaw = rgba(rawR, rawG, rawB, rawA);
    const pixel = colorMode === "RGB" ? pixelRaw : rgba2labaMemo(pixelRaw);

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    const a = pixel[3];

    range.r.min = r < range.r.min ? r : range.r.min;
    range.r.max = r > range.r.max ? r : range.r.max;

    range.g.min = g < range.g.min ? g : range.g.min;
    range.g.max = g > range.g.max ? g : range.g.max;

    range.b.min = b < range.b.min ? b : range.b.min;
    range.b.max = b > range.b.max ? b : range.b.max;

    range.a.min = a < range.a.min ? a : range.a.min;
    range.a.max = a > range.a.max ? a : range.a.max;

    pixels.push(pixel);
  }

  const channelsByRange = [
    { channel: 0, range: range.r.max - range.r.min },
    { channel: 1, range: range.g.max - range.g.min },
    { channel: 2, range: range.b.max - range.b.min },
    { channel: 3, range: range.a.max - range.a.min }
  ].sort((a, b) => b.range - a.range);

  const medianCut = (
    bucket: number[][],
    channelSequence: { channel: number; range: number }[],
    remaining: number,
    iterations: number,
    ignAlpha: boolean,
    adptMode: string
  ): number[][] => {
    if (bucket.length <= 1) {
      return bucket.length === 0 ? [] : [bucket[0] ?? [0, 0, 0, 0]];
    }
    const channel = channelSequence[iterations % (ignAlpha ? 3 : 4)] ?? { channel: 0, range: 0 };
    bucket.sort((a, b) => (b[channel.channel] ?? 0) - (a[channel.channel] ?? 0));
    const midIdx = Math.floor(bucket.length / 2);

    if (remaining <= 0) {
      switch (adaptMode) {
        case "AVERAGE": {
          const acc: [number, number, number, number] = [0, 0, 0, 0];
          bucket.forEach((c: number[]) => {
            acc[0] += (c[0] ?? 0) / bucket.length;
            acc[1] += (c[1] ?? 0) / bucket.length;
            acc[2] += (c[2] ?? 0) / bucket.length;
            acc[3] += (c[3] ?? 0) / bucket.length;
          });
          return [acc.map((ch: number) => Math.floor(ch))];
        }
        case "FIRST":
          return [bucket[0] ?? [0, 0, 0, 0]];
        default:
        case "MID":
          return [bucket[midIdx] ?? [0, 0, 0, 0]];
      }
    }

    // Subsort recursively, cycling through channels
    return [bucket.slice(0, midIdx), bucket.slice(midIdx, bucket.length)]
      .map((g: number[][]) =>
        medianCut(
          g,
          channelSequence,
          remaining - 1,
          iterations + 1,
          ignAlpha,
          adptMode
        )
      )
      .reduce((a: number[][], b: number[][]) => a.concat(b), []);
  };

  const paletteRaw = medianCut(
    pixels,
    channelsByRange,
    limit,
    0,
    ignoreAlpha,
    adaptMode
  ).filter(c => c != null);

  if (colorMode === "RGB") {
    return paletteRaw;
  } else if (colorMode === "LAB") {
    return paletteRaw.map(c => laba2rgba(c));
  }

  return [];
};

export const uniqueColors = (
  buf: Uint8ClampedArray | Uint8Array,
  limit?: number
) => {
  const seen: Record<string, { count: number; color: number[] }> = {};

  for (let i = 0; i < buf.length; i += 4) {
    const [r, g, b, a] = readPixel(buf, i);

    const key = `${r}-${g}-${b}-${a}`;

    if (seen[key] && seen[key].count) {
      seen[key].count += 1;
    } else {
      seen[key] = {
        count: 1,
        color: rgba(r, g, b, a)
      };
    }
  }

  if (limit) {
    return (
      Object.values(seen)
        .sort((a, b) => {
          if (
            !a ||
            !b ||
            typeof a.count !== "number" ||
            typeof b.count !== "number"
          ) {
            return 0;
          }

          if (a.count < b.count) return -1;
          if (a.count > b.count) return 1;
          return 0;
        })
        .slice(0, limit)
        .map(c => c.color)
    );
  }

  return Object.values(seen).map(c => c.color);
};

// Preserves nulls
export const scaleMatrix = (
  mat: Array<Array<number | null>>,
  scale: number
) =>
  mat.map(row => row.map(col => (col ? col * scale : col)));

export const add = (a: number[], b: number[]) => [
  (a[0] ?? 0) + (b[0] ?? 0),
  (a[1] ?? 0) + (b[1] ?? 0),
  (a[2] ?? 0) + (b[2] ?? 0),
  (a[3] ?? 0) + (b[3] ?? 0)
];

export const sub = (a: number[], b: number[]) => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
  (a[3] ?? 0) - (b[3] ?? 0)
];

export const scale = (
  a: number[],
  scalar: number,
  alpha = false
) => [
  scalar * (a[0] ?? 0),
  scalar * (a[1] ?? 0),
  scalar * (a[2] ?? 0),
  alpha ? scalar * (a[3] ?? 0) : (a[3] ?? 0)
];

// contrast factor 0-1 ideally
export const contrast = (color: number[], factor: number) => {
  // normalise to [-1, 1]
  const nC: [number, number, number, number] = [
    (color[0] ?? 0) / 255 - 0.5,
    (color[1] ?? 0) / 255 - 0.5,
    (color[2] ?? 0) / 255 - 0.5,
    color[3] ?? 0
  ];

  return [
    (nC[0] + factor * (nC[0] - 1.0) * nC[0] * (nC[0] - 0.5) + 0.5) * 255,
    (nC[1] + factor * (nC[1] - 1.0) * nC[1] * (nC[1] - 0.5) + 0.5) * 255,
    (nC[2] + factor * (nC[2] - 1.0) * nC[2] * (nC[2] - 0.5) + 0.5) * 255,
    color[3] ?? 0
  ];
};

// factor 0-255, exposure ideally 0-2 (small number)
export const brightness = (
  color: number[],
  factor: number,
  exposure = 1
) => [
  (color[0] ?? 0) * exposure + factor,
  (color[1] ?? 0) * exposure + factor,
  (color[2] ?? 0) * exposure + factor,
  color[3] ?? 0
];

export const gamma = (color: number[], g: number) => [
  255 * ((color[0] ?? 0) / 255) ** (1 / g),
  255 * ((color[1] ?? 0) / 255) ** (1 / g),
  255 * ((color[2] ?? 0) / 255) ** (1 / g),
  color[3] ?? 0
];

export const getBufferIndex = (x: number, y: number, width: number) =>
  (x + width * y) * 4;

// FIXME: Make signature consistent with addBufferPixel
export const fillBufferPixel = (
  buf: Uint8ClampedArray | Uint8Array | Float32Array | number[],
  i: number,
  r: number,
  g: number,
  b: number,
  a: number
) => {
  if (i < buf.length) buf[i] = r;
  if (i + 1 < buf.length) buf[i + 1] = g;
  if (i + 2 < buf.length) buf[i + 2] = b;
  if (i + 3 < buf.length) buf[i + 3] = a;
};

export const addBufferPixel = (
  buf: Uint8ClampedArray | Uint8Array | Float32Array | number[],
  i: number,
  color: number[]
) => {
  if (i < buf.length) buf[i] = (buf[i] ?? 0) + (color[0] ?? 0);
  if (i + 1 < buf.length) buf[i + 1] = (buf[i + 1] ?? 0) + (color[1] ?? 0);
  if (i + 2 < buf.length) buf[i + 2] = (buf[i + 2] ?? 0) + (color[2] ?? 0);
  if (i + 3 < buf.length) buf[i + 3] = (buf[i + 3] ?? 0) + (color[3] ?? 0);
};

// Returns HTMLCanvasElement in the main thread, OffscreenCanvas in workers.
// Typed as HTMLCanvasElement because both share the same 2D API and this
// avoids 180+ downstream TS errors from the union return type.
// Filter chains churn through canvas allocations — at 1280×720 RGBA each
// canvas is ~3.7 MB, and a 5-step chain at 60 Hz hands the GC ~1 GB/s of
// short-lived canvases. Pool them: once a filter hands its output down-
// chain, the previous step's canvas becomes reusable. `releasePooledCanvas`
// is called by the chain dispatcher (FilterContext / filterWorker) after
// each step to return the superseded canvas to the pool.
//
// Entries are keyed by "WxH" — mixed-resolution chains still pool correctly
// per size. We cap each size bucket to avoid accidentally holding huge
// amounts of memory when a chain briefly runs at a bigger resolution.
const CANVAS_POOL_MAX_PER_SIZE = 6;
const _canvasPool = new Map<string, (HTMLCanvasElement | OffscreenCanvas)[]>();

const poolKey = (w: number, h: number): string => `${w}x${h}`;

const createRawCanvas = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
};

// Grab a canvas for the given size — pooled if available, fresh otherwise.
// Caller must treat the contents as undefined (the 2D context is cleared as
// needed by the caller, e.g., via drawImage or putImageData).
export const takePooledCanvas = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
  const key = poolKey(w, h);
  const bucket = _canvasPool.get(key);
  if (bucket && bucket.length > 0) {
    return bucket.pop() as HTMLCanvasElement | OffscreenCanvas;
  }
  return createRawCanvas(w, h);
};

// Return a no-longer-used canvas to the pool. Safe to call with null. The
// caller must not retain references to the canvas or its context after
// release — assume the pool may hand it out to another filter immediately.
export const releasePooledCanvas = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined,
): void => {
  if (!canvas) return;
  const key = poolKey(canvas.width, canvas.height);
  let bucket = _canvasPool.get(key);
  if (!bucket) {
    bucket = [];
    _canvasPool.set(key, bucket);
  }
  if (bucket.length >= CANVAS_POOL_MAX_PER_SIZE) return;
  bucket.push(canvas);
};

export const cloneCanvas = (
  original: HTMLCanvasElement | OffscreenCanvas,
  copyData = true
): HTMLCanvasElement => {
  const clone = takePooledCanvas(original.width, original.height);

  // Every cloned canvas feeds back into the filter pipeline, which calls
  // getImageData on it at least once per subsequent filter. willReadFrequently
  // keeps the backing store CPU-side so those reads don't pay a GPU-readback
  // cost (and don't trigger the browser's "multiple readback" console warning).
  const isHtmlCanvas = typeof HTMLCanvasElement !== "undefined" && clone instanceof HTMLCanvasElement;
  const cloneCtx = (isHtmlCanvas
    ? (clone as HTMLCanvasElement).getContext("2d", { willReadFrequently: true })
    : (clone as OffscreenCanvas).getContext("2d", { willReadFrequently: true })
  ) as CanvasRenderingContext2D | null;

  if (cloneCtx) {
    if (copyData) {
      cloneCtx.drawImage(original, 0, 0);
    } else if (typeof cloneCtx.clearRect === "function") {
      // Pool may hand back a canvas with stale pixels from the previous
      // frame; callers that asked not to copy data expect a blank surface.
      // The feature check is for unit tests that run against a minimal
      // canvas mock (`vitest-canvas-mock`) that doesn't implement clearRect.
      cloneCtx.clearRect(0, 0, clone.width, clone.height);
    }
  }

  return clone as HTMLCanvasElement;
};

export * from "./sampling";
export * from "./motionVectors";
export * from "./workerFrames";
