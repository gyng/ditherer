/* @ts-self-types="./rgba2laba.d.ts" */

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} shadow_cool
 * @param {number} highlight_warm
 * @param {number} black_point
 * @param {number} white_point
 * @param {number} contrast
 * @param {number} midtone_lift
 * @param {number} vibrance
 * @param {number} mix
 */
export function anime_color_grade_buffer(input, output, shadow_cool, highlight_warm, black_point, white_point, contrast, midtone_lift, vibrance, mix) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.anime_color_grade_buffer(ptr0, len0, ptr1, len1, output, shadow_cool, highlight_warm, black_point, white_point, contrast, midtone_lift, vibrance, mix);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {Uint8Array} lut_r
 * @param {Uint8Array} lut_g
 * @param {Uint8Array} lut_b
 */
export function apply_channel_lut(input, output, lut_r, lut_g, lut_b) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(lut_r, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(lut_g, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(lut_b, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    wasm.apply_channel_lut(ptr0, len0, ptr1, len1, output, ptr2, len2, ptr3, len3, ptr4, len4);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {number} threshold
 * @param {number} strength
 * @param {number} radius
 */
export function bloom_buffer(input, output, width, height, threshold, strength, radius) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.bloom_buffer(ptr0, len0, ptr1, len1, output, width, height, threshold, strength, radius);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {Float64Array} kernel
 * @param {number} kernel_width
 * @param {number} kernel_height
 * @param {number} offset_x
 * @param {number} offset_y
 * @param {boolean} serpentine
 * @param {number} row_alt
 * @param {boolean} linearize
 * @param {Uint8Array} prev_input
 * @param {Uint8Array} prev_output
 * @param {number} temporal_bleed
 * @param {number} palette_mode
 * @param {number} levels
 * @param {Float64Array} palette
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 */
export function error_diffuse_buffer(input, output, width, height, kernel, kernel_width, kernel_height, offset_x, offset_y, serpentine, row_alt, linearize, prev_input, prev_output, temporal_bleed, palette_mode, levels, palette, ref_x, ref_y, ref_z) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(kernel, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(prev_input, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(prev_output, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    wasm.error_diffuse_buffer(ptr0, len0, ptr1, len1, output, width, height, ptr2, len2, kernel_width, kernel_height, offset_x, offset_y, serpentine, row_alt, linearize, ptr3, len3, ptr4, len4, temporal_bleed, palette_mode, levels, ptr5, len5, ref_x, ref_y, ref_z);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {Uint32Array} visit_order
 * @param {Float32Array} tuples
 * @param {Uint32Array} kernel_starts
 * @param {Uint32Array} kernel_lens
 * @param {Float32Array} kernel_totals
 * @param {number} err_strategy
 * @param {boolean} linearize
 * @param {Uint8Array} prev_input
 * @param {Uint8Array} prev_output
 * @param {number} temporal_bleed
 * @param {number} palette_mode
 * @param {number} levels
 * @param {Float64Array} palette
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 */
export function error_diffuse_custom_order(input, output, width, height, visit_order, tuples, kernel_starts, kernel_lens, kernel_totals, err_strategy, linearize, prev_input, prev_output, temporal_bleed, palette_mode, levels, palette, ref_x, ref_y, ref_z) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(visit_order, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF32ToWasm0(tuples, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray32ToWasm0(kernel_starts, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArray32ToWasm0(kernel_lens, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArrayF32ToWasm0(kernel_totals, wasm.__wbindgen_malloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArray8ToWasm0(prev_input, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ptr8 = passArray8ToWasm0(prev_output, wasm.__wbindgen_malloc);
    const len8 = WASM_VECTOR_LEN;
    const ptr9 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len9 = WASM_VECTOR_LEN;
    wasm.error_diffuse_custom_order(ptr0, len0, ptr1, len1, output, width, height, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, err_strategy, linearize, ptr7, len7, ptr8, len8, temporal_bleed, palette_mode, levels, ptr9, len9, ref_x, ref_y, ref_z);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {number} sigma
 */
export function gaussian_blur_buffer(input, output, width, height, sigma) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.gaussian_blur_buffer(ptr0, len0, ptr1, len1, output, width, height, sigma);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @param {number} strength
 */
export function grain_merge_buffer(input, output, width, height, radius, strength) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.grain_merge_buffer(ptr0, len0, ptr1, len1, output, width, height, radius, strength);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} hue_shift
 * @param {number} sat_shift
 * @param {number} val_shift
 */
export function hsv_shift_buffer(input, output, hue_shift, sat_shift, val_shift) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.hsv_shift_buffer(ptr0, len0, ptr1, len1, output, hue_shift, sat_shift, val_shift);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {number} pixel_size
 * @param {number} subpixel_layout
 * @param {number} brightness
 * @param {number} gap_darkness
 */
export function lcd_display_buffer(input, output, width, height, pixel_size, subpixel_layout, brightness, gap_darkness) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.lcd_display_buffer(ptr0, len0, ptr1, len1, output, width, height, pixel_size, subpixel_layout, brightness, gap_darkness);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
export function median_filter_buffer(input, output, width, height, radius) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.median_filter_buffer(ptr0, len0, ptr1, len1, output, width, height, radius);
}

/**
 * Per-pixel nearest with pre-converted Lab palette.
 * `palette_lab` is [L0,a0,b0, L1,a1,b1, …] (already in Lab space).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {Float64Array} palette_lab
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 * @returns {number}
 */
export function nearest_lab_precomputed(r, g, b, palette_lab, ref_x, ref_y, ref_z) {
    const ptr0 = passArrayF64ToWasm0(palette_lab, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.nearest_lab_precomputed(r, g, b, ptr0, len0, ref_x, ref_y, ref_z);
    return ret >>> 0;
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {Float64Array} threshold_map
 * @param {number} threshold_w
 * @param {number} threshold_h
 * @param {number} temporal_ox
 * @param {number} temporal_oy
 * @param {number} ordered_levels
 * @param {number} palette_mode
 * @param {number} levels
 * @param {Float64Array} palette
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 */
export function ordered_dither_linear_buffer(input, output, width, height, threshold_map, threshold_w, threshold_h, temporal_ox, temporal_oy, ordered_levels, palette_mode, levels, palette, ref_x, ref_y, ref_z) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(threshold_map, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    wasm.ordered_dither_linear_buffer(ptr0, len0, ptr1, len1, output, width, height, ptr2, len2, threshold_w, threshold_h, temporal_ox, temporal_oy, ordered_levels, palette_mode, levels, ptr3, len3, ref_x, ref_y, ref_z);
}

/**
 * Quantize buffer using HSV distance with circular hue.
 * @param {Uint8Array} buffer
 * @param {Float64Array} palette
 * @returns {Uint8Array}
 */
export function quantize_buffer_hsv(buffer, palette) {
    const ptr0 = passArray8ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.quantize_buffer_hsv(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Quantize an entire RGBA u8 buffer in one call.
 * Converts palette to Lab once, then finds nearest for every pixel.
 * `buffer` is [r,g,b,a, r,g,b,a, …] u8 values.
 * `palette` is [r,g,b,a, …] f64 values (0-255).
 * Returns a new u8 buffer with matched palette colours (alpha preserved).
 * @param {Uint8Array} buffer
 * @param {Float64Array} palette
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 * @returns {Uint8Array}
 */
export function quantize_buffer_lab(buffer, palette, ref_x, ref_y, ref_z) {
    const ptr0 = passArray8ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.quantize_buffer_lab(ptr0, len0, ptr1, len1, ref_x, ref_y, ref_z);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Quantize buffer using squared Euclidean RGB distance.
 * @param {Uint8Array} buffer
 * @param {Float64Array} palette
 * @returns {Uint8Array}
 */
export function quantize_buffer_rgb(buffer, palette) {
    const ptr0 = passArray8ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.quantize_buffer_rgb(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Quantize buffer using red-mean perceptual RGB approximation.
 * @param {Uint8Array} buffer
 * @param {Float64Array} palette
 * @returns {Uint8Array}
 */
export function quantize_buffer_rgb_approx(buffer, palette) {
    const ptr0 = passArray8ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.quantize_buffer_rgb_approx(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 * @returns {Float64Array}
 */
export function rgba2laba(r, g, b, a, ref_x, ref_y, ref_z) {
    const ret = wasm.rgba2laba(r, g, b, a, ref_x, ref_y, ref_z);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} a1
 * @param {number} r2
 * @param {number} g2
 * @param {number} b2
 * @param {number} a2
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 * @returns {number}
 */
export function rgba_laba_distance(r1, g1, b1, a1, r2, g2, b2, a2, ref_x, ref_y, ref_z) {
    const ret = wasm.rgba_laba_distance(r1, g1, b1, a1, r2, g2, b2, a2, ref_x, ref_y, ref_z);
    return ret;
}

/**
 * Find the index of the nearest palette colour in Lab space.
 * `palette` is a flat [r0,g0,b0,a0, r1,g1,b1,a1, …] slice.
 * Returns the 0-based index of the nearest entry.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {Float64Array} palette
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 * @returns {number}
 */
export function rgba_nearest_lab_index(r, g, b, a, palette, ref_x, ref_y, ref_z) {
    const ptr0 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rgba_nearest_lab_index(r, g, b, a, ptr0, len0, ref_x, ref_y, ref_z);
    return ret >>> 0;
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} width
 * @param {number} height
 * @param {number} amplitude
 * @param {number} frequency
 * @param {number} phase_rad
 * @param {number} anim_offset
 */
export function scanline_warp_buffer(input, output, width, height, amplitude, frequency, phase_rad, anim_offset) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.scanline_warp_buffer(ptr0, len0, ptr1, len1, output, width, height, amplitude, frequency, phase_rad, anim_offset);
}

/**
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} levels
 * @param {number} seed
 * @param {number} palette_mode
 * @param {Float64Array} palette
 * @param {number} ref_x
 * @param {number} ref_y
 * @param {number} ref_z
 */
export function triangle_dither_buffer(input, output, levels, seed, palette_mode, palette, ref_x, ref_y, ref_z) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(output, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(palette, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    wasm.triangle_dither_buffer(ptr0, len0, ptr1, len1, output, levels, seed, palette_mode, ptr2, len2, ref_x, ref_y, ref_z);
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_a4db337751e0b328: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rgba2laba_bg.js": import0,
    };
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rgba2laba_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
