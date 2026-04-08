/* tslint:disable */
/* eslint-disable */

/**
 * Per-pixel nearest with pre-converted Lab palette.
 * `palette_lab` is [L0,a0,b0, L1,a1,b1, …] (already in Lab space).
 */
export function nearest_lab_precomputed(r: number, g: number, b: number, palette_lab: Float64Array, ref_x: number, ref_y: number, ref_z: number): number;

/**
 * Quantize buffer using HSV distance with circular hue.
 */
export function quantize_buffer_hsv(buffer: Uint8Array, palette: Float64Array): Uint8Array;

/**
 * Quantize an entire RGBA u8 buffer in one call.
 * Converts palette to Lab once, then finds nearest for every pixel.
 * `buffer` is [r,g,b,a, r,g,b,a, …] u8 values.
 * `palette` is [r,g,b,a, …] f64 values (0-255).
 * Returns a new u8 buffer with matched palette colours (alpha preserved).
 */
export function quantize_buffer_lab(buffer: Uint8Array, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): Uint8Array;

/**
 * Quantize buffer using squared Euclidean RGB distance.
 */
export function quantize_buffer_rgb(buffer: Uint8Array, palette: Float64Array): Uint8Array;

/**
 * Quantize buffer using red-mean perceptual RGB approximation.
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly rgba2laba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly rgba_laba_distance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly rgba_nearest_lab_index: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly nearest_lab_precomputed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly quantize_buffer_lab: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly quantize_buffer_rgb: (a: number, b: number, c: number, d: number) => [number, number];
    readonly quantize_buffer_rgb_approx: (a: number, b: number, c: number, d: number) => [number, number];
    readonly quantize_buffer_hsv: (a: number, b: number, c: number, d: number) => [number, number];
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
