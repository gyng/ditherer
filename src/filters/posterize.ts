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
  logFilterBackend,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity as paletteIsIdentityFn } from "palettes/backend";
import { posterizeGLAvailable, renderPosterizeGL } from "./posterizeGL";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 32], step: 1, default: 4, desc: "Number of distinct color levels per channel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  palette: optionTypes.palette.default
};

const posterize = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { levels, palette } = options;
  const W = input.width;
  const H = input.height;

  if (options._webglAcceleration !== false && posterizeGLAvailable()) {
    const rendered = renderPosterizeGL(input, W, H, levels);
    if (rendered) {
      const identity = paletteIsIdentityFn(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Posterize", "WebGL2", `levels=${levels}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const step = 255 / (levels - 1);
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      lut[i] = Math.max(0, Math.min(255, Math.round(Math.round(i / step) * step)));
    }
    wasmApplyChannelLut(buf, buf, lut, lut, lut);
    if (!paletteIsIdentity) {
      for (let i = 0; i < buf.length; i += 4) {
        const col = srgbPaletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options);
        fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
      }
    }
    logFilterWasmStatus("Posterize", true, paletteIsIdentity ? `levels=${levels}` : `levels=${levels}+palettePass`);
    outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
    return output;
  }
  logFilterWasmStatus("Posterize", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
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
  name: "Posterize",
  func: posterize,
  options: defaults,
  optionTypes,
  defaults
});
