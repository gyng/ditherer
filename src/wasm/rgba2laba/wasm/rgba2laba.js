/* @ts-self-types="./rgba2laba.d.ts" */

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

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
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

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
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
    cachedFloat64ArrayMemory0 = null;
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
