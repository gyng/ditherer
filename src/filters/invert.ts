import { BOOL } from "constants/controlTypes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  wasmApplyChannelLut,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  invertR: { type: BOOL, default: true, desc: "Invert red channel" },
  invertG: { type: BOOL, default: true, desc: "Invert green channel" },
  invertB: { type: BOOL, default: true, desc: "Invert blue channel" },
  invertA: { type: BOOL, default: false, desc: "Invert alpha channel" }
};

export const defaults = {
  invertR: optionTypes.invertR.default,
  invertG: optionTypes.invertG.default,
  invertB: optionTypes.invertB.default,
  invertA: optionTypes.invertA.default
};

const invert = (
  input: any,
  options: typeof defaults & { _wasmAcceleration?: boolean } = defaults
) => {
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  // WASM fast path for the common case (alpha not inverted) — R/G/B/A are
  // fully independent so three 256-entry per-channel LUTs cover it, and
  // alpha stays untouched by the primitive. If alpha is being inverted we
  // could pre-invert it on the buffer before the WASM apply, but it's a
  // narrow case and dropping to the JS loop keeps the code honest.
  if (wasmIsLoaded() && options._wasmAcceleration !== false && !options.invertA) {
    const identity = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) identity[i] = i;
    const inverted = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) inverted[i] = 255 - i;
    const lutR = options.invertR ? inverted : identity;
    const lutG = options.invertG ? inverted : identity;
    const lutB = options.invertB ? inverted : identity;
    wasmApplyChannelLut(buf, buf, lutR, lutG, lutB);
    logFilterWasmStatus("Invert", true, `r=${options.invertR ? 1 : 0} g=${options.invertG ? 1 : 0} b=${options.invertB ? 1 : 0}`);
    outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
    return output;
  }
  logFilterWasmStatus("Invert", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : options.invertA ? "invertA on (JS path)" : "wasm not loaded yet");

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const r = options.invertR ? 255 - buf[i] : buf[i];
      const g = options.invertG ? 255 - buf[i + 1] : buf[i + 1];
      const b = options.invertB ? 255 - buf[i + 2] : buf[i + 2];
      const a = options.invertA ? 255 - buf[i + 3] : buf[i + 3];
      fillBufferPixel(buf, i, r, g, b, a);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Invert",
  func: invert,
  options: defaults,
  optionTypes,
  defaults
});
