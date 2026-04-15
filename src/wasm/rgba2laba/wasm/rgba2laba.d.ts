/* tslint:disable */
/* eslint-disable */

export function anime_color_grade_buffer(input: Uint8Array, output: Uint8Array, shadow_cool: number, highlight_warm: number, black_point: number, white_point: number, contrast: number, midtone_lift: number, vibrance: number, mix: number): void;

export function apply_channel_lut(input: Uint8Array, output: Uint8Array, lut_r: Uint8Array, lut_g: Uint8Array, lut_b: Uint8Array): void;

export function bloom_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, threshold: number, strength: number, radius: number): void;

export function error_diffuse_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, kernel: Float64Array, kernel_width: number, kernel_height: number, offset_x: number, offset_y: number, serpentine: boolean, row_alt: number, linearize: boolean, prev_input: Uint8Array, prev_output: Uint8Array, temporal_bleed: number, palette_mode: number, levels: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

export function error_diffuse_custom_order(input: Uint8Array, output: Uint8Array, width: number, height: number, visit_order: Uint32Array, tuples: Float32Array, kernel_starts: Uint32Array, kernel_lens: Uint32Array, kernel_totals: Float32Array, err_strategy: number, linearize: boolean, prev_input: Uint8Array, prev_output: Uint8Array, temporal_bleed: number, palette_mode: number, levels: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

export function gaussian_blur_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, sigma: number): void;

export function grain_merge_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, radius: number, strength: number): void;

export function hsv_shift_buffer(input: Uint8Array, output: Uint8Array, hue_shift: number, sat_shift: number, val_shift: number): void;

export function lcd_display_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, pixel_size: number, subpixel_layout: number, brightness: number, gap_darkness: number): void;

export function lens_distortion_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, k1: number, k2: number, zoom: number): void;

export function median_filter_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, radius: number): void;

/**
 * Per-pixel nearest with pre-converted Lab palette.
 * `palette_lab` is [L0,a0,b0, L1,a1,b1, …] (already in Lab space).
 */
export function nearest_lab_precomputed(r: number, g: number, b: number, palette_lab: Float64Array, ref_x: number, ref_y: number, ref_z: number): number;

export function oil_painting_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, radius: number, levels: number): void;

export function ordered_dither_linear_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, threshold_map: Float64Array, threshold_w: number, threshold_h: number, temporal_ox: number, temporal_oy: number, ordered_levels: number, palette_mode: number, levels: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

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

export function scanline_warp_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, amplitude: number, frequency: number, phase_rad: number, anim_offset: number): void;

export function tilt_shift_buffer(input: Uint8Array, output: Uint8Array, width: number, height: number, focus_position: number, focus_width: number, blur_amount: number, saturation_boost: number): void;

export function triangle_dither_buffer(input: Uint8Array, output: Uint8Array, levels: number, seed: number, palette_mode: number, palette: Float64Array, ref_x: number, ref_y: number, ref_z: number): void;

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
    readonly error_diffuse_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number) => void;
    readonly error_diffuse_custom_order: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number) => void;
    readonly ordered_dither_linear_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number) => void;
    readonly quantize_buffer_hsv: (a: number, b: number, c: number, d: number) => [number, number];
    readonly anime_color_grade_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly median_filter_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number) => void;
    readonly bloom_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number) => void;
    readonly gaussian_blur_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number) => void;
    readonly grain_merge_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number) => void;
    readonly oil_painting_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number) => void;
    readonly lens_distortion_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number) => void;
    readonly tilt_shift_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly scanline_warp_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly lcd_display_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly triangle_dither_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly hsv_shift_buffer: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number) => void;
    readonly apply_channel_lut: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number) => void;
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
