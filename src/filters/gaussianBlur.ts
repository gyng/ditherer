import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  getBufferIndex,
  wasmGaussianBlurBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
  logFilterBackend,
} from "utils";
import { applyPaletteToBuffer, paletteIsIdentity as isIdentityPalette } from "palettes/backend";
import { gaussianBlurGLAvailable, renderGaussianBlurGL } from "./gaussianBlurGL";

export const optionTypes = {
  sigma: { type: RANGE, range: [0.5, 20], step: 0.5, default: 3, desc: "Blur radius — higher values produce a softer image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  sigma: optionTypes.sigma.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type GaussianBlurOptions = typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean };

const gaussianBlurFilter = (input: any, options: GaussianBlurOptions = defaults) => {
  const { sigma, palette } = options;
  const wasmOk: boolean = (options as { _wasmAcceleration?: boolean })._wasmAcceleration !== false;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const paletteIdentity = isIdentityPalette(palette);

  // GL fast path. The blur always runs in GL when available; for custom
  // palettes we read the result back and run the standard CPU palette pass
  // (matches the Displace / Mode 7 pattern). Honors both `_wasmAcceleration`
  // (turning off *any* acceleration) and the more specific `_webglAcceleration`.
  if (
    wasmOk
    && options._webglAcceleration !== false
    && gaussianBlurGLAvailable()
  ) {
    const rendered = renderGaussianBlurGL(input, W, H, sigma);
    if (rendered && typeof (rendered as { getContext?: unknown }).getContext === "function") {
      if (paletteIdentity) {
        logFilterBackend("Gaussian Blur", "WebGL2", `gpu sigma=${sigma}`);
        return rendered;
      }
      const rCtx = (rendered as HTMLCanvasElement | OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (rCtx) {
        const pixels = rCtx.getImageData(0, 0, W, H).data;
        applyPaletteToBuffer(pixels, pixels, W, H, palette, wasmOk);
        rCtx.putImageData(new ImageData(pixels, W, H), 0, 0);
        logFilterBackend("Gaussian Blur", "WebGL2", `gpu sigma=${sigma}+palettePass`);
        return rendered;
      }
    }
  }

  if (wasmIsLoaded() && wasmOk) {
    const outBuf = new Uint8ClampedArray(buf.length);
    wasmGaussianBlurBuffer(buf, outBuf, W, H, sigma);
    applyPaletteToBuffer(outBuf, outBuf, W, H, palette, wasmOk);
    logFilterWasmStatus("Gaussian Blur", true, paletteIdentity ? `sigma=${sigma}` : `sigma=${sigma}+palettePass`);
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

  // Vertical pass — write straight u8 output, palette quantization happens
  // in a single batched pass below via the shared primitive.
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
      outBuf[di]     = Math.round(r);
      outBuf[di + 1] = Math.round(g);
      outBuf[di + 2] = Math.round(b);
      outBuf[di + 3] = Math.round(a);
    }
  }

  applyPaletteToBuffer(outBuf, outBuf, W, H, palette, wasmOk);
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
