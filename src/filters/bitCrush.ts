import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
  wasmApplyChannelLut,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";
import { applyPaletteToBuffer, paletteIsIdentity } from "palettes/backend";
import { defineFilter } from "filters/types";

export const optionTypes = {
  bits: { type: RANGE, range: [1, 8], step: 1, default: 3, desc: "Bits per channel — fewer bits = harsher posterization" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bits: optionTypes.bits.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type BitCrushOptions = typeof defaults & { _wasmAcceleration?: boolean };

const bitCrush = (input: any, options: BitCrushOptions = defaults) => {
  const { bits, palette } = options;
  const wasmOk = (options as { _wasmAcceleration?: boolean })._wasmAcceleration !== false;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const levels = 2 ** bits;
  const step = 255 / (levels - 1);

  // WASM fast path: the inner loop is a pure per-channel u8 → u8 remap, so
  // the whole filter reduces to one 256-entry LUT (bit-crush quantize) +
  // a palette pass (shared primitive). Applies uniformly to all palettes —
  // nearest goes through the WASM LUT path, others loop in JS after the
  // bit-crush LUT has already done its work.
  if (wasmOk && wasmIsLoaded()) {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      lut[i] = Math.round(Math.round(i / step) * step);
    }
    const outBuf = new Uint8ClampedArray(buf.length);
    wasmApplyChannelLut(buf, outBuf, lut, lut, lut);
    applyPaletteToBuffer(outBuf, outBuf, W, H, palette, wasmOk);
    logFilterWasmStatus("Bit crush", true, `bits=${bits}${paletteIsIdentity(palette) ? "" : "+palette"}`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Bit crush", false, !wasmOk ? "_wasmAcceleration off" : "wasm not loaded yet");

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const r = Math.round(Math.round(buf[i] / step) * step);
      const g = Math.round(Math.round(buf[i + 1] / step) * step);
      const b = Math.round(Math.round(buf[i + 2] / step) * step);
      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Bit crush",
  func: bitCrush,
  options: defaults,
  optionTypes,
  defaults
});
