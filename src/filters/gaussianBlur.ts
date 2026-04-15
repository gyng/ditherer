import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmGaussianBlurBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";
import { gaussianBlurGLAvailable, renderGaussianBlurGL } from "./gaussianBlurGL";

export const optionTypes = {
  sigma: { type: RANGE, range: [0.5, 20], step: 0.5, default: 3, desc: "Blur radius — higher values produce a softer image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  sigma: optionTypes.sigma.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const gaussianBlurFilter = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean } = defaults) => {
  const { sigma, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  // GL fast path: only identity palette (the default). Non-identity palettes
  // fall through to WASM/JS below, which apply the palette per pixel.
  if (paletteIsIdentity && options._wasmAcceleration !== false && gaussianBlurGLAvailable()) {
    const rendered = renderGaussianBlurGL(input, W, H, sigma);
    if (rendered) {
      logFilterWasmStatus("Gaussian Blur", true, `gpu sigma=${sigma}`);
      return rendered;
    }
  }

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    const outBuf = new Uint8ClampedArray(buf.length);
    wasmGaussianBlurBuffer(buf, outBuf, W, H, sigma);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
      }
    }
    logFilterWasmStatus("Gaussian Blur", true, paletteIsIdentity ? `sigma=${sigma}` : `sigma=${sigma}+palettePass`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Gaussian Blur", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  // Build 1D Gaussian kernel
  const radius = Math.ceil(sigma * 3);
  const kernelSize = radius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

  // Horizontal pass
  const temp = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const si = getBufferIndex(nx, y, W);
        const w = kernel[k + radius];
        r += buf[si] * w;
        g += buf[si + 1] * w;
        b += buf[si + 2] * w;
        a += buf[si + 3] * w;
      }
      const idx = (y * W + x) * 4;
      temp[idx] = r; temp[idx + 1] = g; temp[idx + 2] = b; temp[idx + 3] = a;
    }
  }

  // Vertical pass
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const idx = (ny * W + x) * 4;
        const w = kernel[k + radius];
        r += temp[idx] * w;
        g += temp[idx + 1] * w;
        b += temp[idx + 2] * w;
        a += temp[idx + 3] * w;
      }
      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(Math.round(r), Math.round(g), Math.round(b), Math.round(a)), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(a));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Gaussian Blur",
  func: gaussianBlurFilter,
  optionTypes,
  options: defaults,
  defaults
});
