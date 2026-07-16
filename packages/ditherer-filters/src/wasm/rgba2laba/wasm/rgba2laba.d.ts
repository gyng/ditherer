/* tslint:disable */
/* eslint-disable */

export function apply_channel_lut(input: Uint8Array, output: Uint8Array, lut_r: Uint8Array, lut_g: Uint8Array, lut_b: Uint8Array): void;

export function error_diffuse_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, kernel: Float64Array, kernel_width: number, kernel_height: number, offset_x: number, offset_y: number, serpentine: boolean, row_alt: number, linearize: boolean, prev_input: Uint8Array, prev_output: Uint8Array, temporal_bleed: number, palette_mode: number, levels: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

export function error_diffuse_custom_order(input: Uint8Array, output: Uint8Array, width: number, height: number, visit_order: Uint32Array, tuples: Float32Array, kernel_starts: Uint32Array, kernel_lens: Uint32Array, kernel_totals: Float32Array, err_strategy: number, linearize: boolean, prev_input: Uint8Array, prev_output: Uint8Array, temporal_bleed: number, palette_mode: number, levels: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

/**
 * Per-pixel nearest with pre-converted Lab palette.
 * `palette_lab` is [L0,a0,b0, L1,a1,b1, …] (already in Lab space).
 */
export function nearest_lab_precomputed(r: number, g: number, b: number, palette_lab: Float64Array, ref_x: number, ref_y: number, ref_z: number): number;

/**
 * Quantize a buffer using HSV distance. Mirrors colorDistance(HSV_NEAREST).
 *
 * All three terms are normalised to 0..1: hue by the /180 (its range is 0..360),
 * saturation and value are already 0..1 out of rgb_to_hsv. The JS used to divide
 * the value term by 255 on top of that, scaling brightness to ~1/65000 of the
 * other axes — HSV matched white to black against a [black, red] palette. The
 * in-shader version in orderedGL never had the divisor, so GL and CPU disagreed
 * on every HSV palette; all three now use this formula.
 */
export function quantize_buffer_hsv(buffer: Uint8Array, palette: Float64Array): Uint8Array;

/**
 * Quantize an entire RGBA u8 buffer in one call using CIE Lab distance.
 * Converts the palette to Lab once, then finds the nearest for every pixel.
 *
 * The counterpart to `quantize_buffer_rgb`, and the same reason for existing:
 * per-pixel WASM Lab matching is SLOWER than plain JS because each pixel pays a
 * JS<->WASM boundary crossing (16-colour scan: 241,905 hz in JS vs 59,201 hz
 * through per-pixel WASM). Doing the whole buffer in one call amortises it.
 *
 * Alpha is copied from the source and never scored, matching
 * colorDistance(LAB_NEAREST) and the JS palette loop.
 */
export function quantize_buffer_lab(buffer: Uint8Array, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): Uint8Array;

/**
 * Quantize a buffer to a palette using OKLab distance.
 * Mirrors colorDistance(OKLAB_NEAREST) exactly, tie-breaking included.
 */
export function quantize_buffer_oklab(buffer: Uint8Array, palette: Float64Array): Uint8Array;

/**
 * `buffer` is [r,g,b,a, r,g,b,a, …] u8 values.
 * `palette` is [r,g,b,a, …] f64 values (0-255).
 * Returns a new u8 buffer with matched palette colours (alpha preserved).
 */
export function quantize_buffer_rgb(buffer: Uint8Array, palette: Float64Array): Uint8Array;

/**
 * Quantize a buffer using the red-mean perceptual RGB approximation.
 * Mirrors colorDistance(RGB_APPROX) exactly, including the /256 divisors.
 */
export function quantize_buffer_rgb_approx(buffer: Uint8Array, palette: Float64Array): Uint8Array;

export function rgba2laba(r: number, g: number, b: number, a: number, ref_x: number, ref_y: number, ref_z: number): Float64Array;

export function rgba_laba_distance(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number, ref_x: number, ref_y: number, ref_z: number): number;

/**
 * Find the index of the nearest palette colour in Lab space.
 * `palette` is a flat [r0,g0,b0,a0, r1,g1,b1,a1, …] slice.
 * Returns the 0-based index of the nearest entry.
 */
export function rgba_nearest_lab_index(r: number, g: number, b: number, a: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): number;

export function riemersma_dither(input: Uint8Array, output: Uint8Array, width: number, height: number, memory_length: number, falloff_ratio: number, error_strength: number, linearize: boolean, palette_mode: number, levels: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly apply_channel_lut: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly error_diffuse_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number) => void;
    readonly error_diffuse_custom_order: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number) => void;
    readonly nearest_lab_precomputed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly quantize_buffer_hsv: (a: number, b: number, c: number, d: number) => [number, number];
    readonly quantize_buffer_lab: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly quantize_buffer_oklab: (a: number, b: number, c: number, d: number) => [number, number];
    readonly quantize_buffer_rgb: (a: number, b: number, c: number, d: number) => [number, number];
    readonly quantize_buffer_rgb_approx: (a: number, b: number, c: number, d: number) => [number, number];
    readonly rgba2laba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly rgba_laba_distance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly rgba_nearest_lab_index: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly riemersma_dither: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
