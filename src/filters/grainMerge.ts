import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmGrainMergeBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
  logFilterBackend,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity as paletteIsIdentityFn } from "palettes/backend";
import { grainMergeGLAvailable, renderGrainMergeGL } from "./grainMergeGL";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 2], step: 0.1, default: 0.5, desc: "Grain merge intensity" },
  radius: { type: RANGE, range: [1, 10], step: 1, default: 3, desc: "Blur radius for grain extraction" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const grainMerge = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { strength, radius, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && grainMergeGLAvailable()) {
    const rendered = renderGrainMergeGL(input, W, H, radius, strength);
    if (rendered) {
      const identity = paletteIsIdentityFn(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Grain Merge", "WebGL2", `r=${radius} strength=${strength}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmGrainMergeBuffer(buf, outBuf, W, H, radius, strength);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const col = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, col[0], col[1], col[2], outBuf[i + 3]);
      }
    }
    logFilterWasmStatus("Grain Merge", true, paletteIsIdentity ? "integral-image" : "integral-image+palettePass");
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  logFilterWasmStatus("Grain Merge", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  // Box blur for low-pass
  const blurR = new Float32Array(W * H), blurG = new Float32Array(W * H), blurB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          sr += buf[ni]; sg += buf[ni + 1]; sb += buf[ni + 2]; cnt++;
        }
      }
      const pi = y * W + x;
      blurR[pi] = sr / cnt; blurG[pi] = sg / cnt; blurB[pi] = sb / cnt;
    }

  // High-pass = original - blurred, then merge back
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const pi = y * W + x;
      const hpR = buf[i] - blurR[pi];
      const hpG = buf[i + 1] - blurG[pi];
      const hpB = buf[i + 2] - blurB[pi];

      const r = Math.max(0, Math.min(255, Math.round(buf[i] + hpR * strength)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] + hpG * strength)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] + hpB * strength)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Grain Merge", func: grainMerge, optionTypes, options: defaults, defaults });
