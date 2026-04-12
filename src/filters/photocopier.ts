import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  contrast: { type: RANGE, range: [1, 5], step: 0.1, default: 2.5, desc: "Copy contrast — higher = blown-out whites" },
  edgeDarken: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Edge darkening around details" },
  speckle: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Random toner speckle amount" },
  generationLoss: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Quality degradation from copy-of-a-copy" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  contrast: optionTypes.contrast.default,
  edgeDarken: optionTypes.edgeDarken.default,
  speckle: optionTypes.speckle.default,
  generationLoss: optionTypes.generationLoss.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const photocopier = (input, options = defaults) => {
  const { contrast, edgeDarken, speckle, generationLoss, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Edge detection for darkening
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let l = lum[y * W + x] / 255;

      // High contrast curve
      l = Math.pow(l, 1 / contrast);
      l = (l - 0.5) * contrast + 0.5;
      l = Math.max(0, Math.min(1, l));

      // Edge darkening via Sobel
      if (edgeDarken > 0 && x > 0 && x < W - 1 && y > 0 && y < H - 1) {
        const gx = -lum[(y - 1) * W + (x - 1)] - 2 * lum[y * W + (x - 1)] - lum[(y + 1) * W + (x - 1)]
                  + lum[(y - 1) * W + (x + 1)] + 2 * lum[y * W + (x + 1)] + lum[(y + 1) * W + (x + 1)];
        const gy = -lum[(y - 1) * W + (x - 1)] - 2 * lum[(y - 1) * W + x] - lum[(y - 1) * W + (x + 1)]
                  + lum[(y + 1) * W + (x - 1)] + 2 * lum[(y + 1) * W + x] + lum[(y + 1) * W + (x + 1)];
        const edge = Math.sqrt(gx * gx + gy * gy) / 1440; // normalize
        l -= edge * edgeDarken;
        l = Math.max(0, l);
      }

      // Speckle noise
      if (speckle > 0 && rng() < speckle * 0.3) {
        l += (rng() - 0.5) * speckle;
        l = Math.max(0, Math.min(1, l));
      }

      // Generation loss: reduce detail by quantizing
      if (generationLoss > 0) {
        const steps = Math.max(2, Math.round(32 * (1 - generationLoss)));
        l = Math.round(l * steps) / steps;
      }

      // Convert to grayscale-ish (photocopier output)
      const v = Math.round(l * 255);
      const color = paletteGetColor(palette, rgba(v, v, v, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Photocopier", func: photocopier, optionTypes, options: defaults, defaults });
