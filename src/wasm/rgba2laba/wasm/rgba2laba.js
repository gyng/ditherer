import * as wasm from "./rgba2laba_bg";

let cachegetFloat64Memory = null;
function getFloat64Memory() {
  if (
    cachegetFloat64Memory === null ||
    cachegetFloat64Memory.buffer !== wasm.memory.buffer
  ) {
    // eslint-disable-next-line no-undef
    cachegetFloat64Memory = new Float64Array(wasm.memory.buffer);
  }
  return cachegetFloat64Memory;
}

function getArrayF64FromWasm(ptr, len) {
  return getFloat64Memory().subarray(ptr / 8, ptr / 8 + len);
}

let cachedGlobalArgumentPtr = null;
function globalArgumentPtr() {
  if (cachedGlobalArgumentPtr === null) {
    cachedGlobalArgumentPtr = wasm.__wbindgen_global_argument_ptr();
  }
  return cachedGlobalArgumentPtr;
}

let cachegetUint32Memory = null;
function getUint32Memory() {
  if (
    cachegetUint32Memory === null ||
    cachegetUint32Memory.buffer !== wasm.memory.buffer
  ) {
    // eslint-disable-next-line no-undef
    cachegetUint32Memory = new Uint32Array(wasm.memory.buffer);
  }
  return cachegetUint32Memory;
}
/**
 * @param {number} arg0
 * @param {number} arg1
 * @param {number} arg2
 * @param {number} arg3
 * @param {number} arg4
 * @param {number} arg5
 * @param {number} arg6
 * @returns {Float64Array}
 */
export function rgba2laba(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
  const retptr = globalArgumentPtr();
  wasm.rgba2laba(retptr, arg0, arg1, arg2, arg3, arg4, arg5, arg6);
  const mem = getUint32Memory();
  const rustptr = mem[retptr / 4];
  const rustlen = mem[retptr / 4 + 1];

  const realRet = getArrayF64FromWasm(rustptr, rustlen).slice();
  wasm.__wbindgen_free(rustptr, rustlen * 8);
  return realRet;
}

/**
 * @param {number} arg0
 * @param {number} arg1
 * @param {number} arg2
 * @param {number} arg3
 * @param {number} arg4
 * @param {number} arg5
 * @param {number} arg6
 * @param {number} arg7
 * @param {number} arg8
 * @param {number} arg9
 * @param {number} arg10
 * @returns {number}
 */
// eslint-disable-next-line @typescript-eslint/camelcase
export function rgba_laba_distance(
  arg0,
  arg1,
  arg2,
  arg3,
  arg4,
  arg5,
  arg6,
  arg7,
  arg8,
  arg9,
  arg10
) {
  return wasm.rgba_laba_distance(
    arg0,
    arg1,
    arg2,
    arg3,
    arg4,
    arg5,
    arg6,
    arg7,
    arg8,
    arg9,
    arg10
  );
}
