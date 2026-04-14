import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmApplyChannelLut,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5, desc: "Number of color levels" },
  smoothness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Transition smoothness between levels" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  smoothness: optionTypes.smoothness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Precompute the per-channel transfer function. Since the quantize function
// depends only on the channel byte value (0..255), we can build it once and
// reuse it for every pixel — either via WASM (all 256 inputs mapped up front)
// or inline in the JS loop.
const buildSmoothPosterizeLut = (levels: number, smoothness: number): Uint8Array => {
  const lut = new Uint8Array(256);
  const step = 255 / (levels - 1);
  const transitionWidth = step * smoothness * 0.5;
  const halfStep = step / 2;
  for (let v = 0; v < 256; v += 1) {
    const bandCenter = Math.round(v / step) * step;
    let out: number;
    if (transitionWidth < 1) {
      out = bandCenter;
    } else {
      const distToEdge = Math.abs(v - bandCenter);
      if (distToEdge > halfStep - transitionWidth) {
        const nextBand = v > bandCenter
          ? Math.min(255, bandCenter + step)
          : Math.max(0, bandCenter - step);
        const t = (distToEdge - (halfStep - transitionWidth)) / (transitionWidth * 2);
        const smoothT = t * t * (3 - 2 * t);
        out = bandCenter + (nextBand - bandCenter) * smoothT;
      } else {
        out = bandCenter;
      }
    }
    lut[v] = Math.max(0, Math.min(255, Math.round(out)));
  }
  return lut;
};

const smoothPosterize = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean } = defaults) => {
  const { levels, smoothness, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lut = buildSmoothPosterizeLut(levels, smoothness);
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmApplyChannelLut(buf, outBuf, lut, lut, lut);
    if (!paletteIsIdentity) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = getBufferIndex(x, y, W);
          const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
        }
      }
    }
    logFilterWasmStatus("Smooth Posterize", true, paletteIsIdentity ? "lut" : "lut+palettePass");
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  logFilterWasmStatus("Smooth Posterize", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = lut[buf[i]];
      const g = lut[buf[i + 1]];
      const b = lut[buf[i + 2]];
      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Smooth Posterize", func: smoothPosterize, optionTypes, options: defaults, defaults });
