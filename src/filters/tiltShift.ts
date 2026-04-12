import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  focusPosition: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical position of the in-focus band (0=top, 1=bottom)" },
  focusWidth: { type: RANGE, range: [0.01, 0.5], step: 0.01, default: 0.15, desc: "Height of the sharp focus band as fraction of image" },
  blurAmount: { type: RANGE, range: [1, 20], step: 1, default: 8, desc: "Gaussian blur sigma for out-of-focus areas" },
  saturationBoost: { type: RANGE, range: [0, 0.5], step: 0.05, default: 0.2, desc: "Extra color saturation for a miniature/toy look" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  focusPosition: optionTypes.focusPosition.default,
  focusWidth: optionTypes.focusWidth.default,
  blurAmount: optionTypes.blurAmount.default,
  saturationBoost: optionTypes.saturationBoost.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const tiltShiftFilter = (input, options = defaults) => {
  const { focusPosition, focusWidth, blurAmount, saturationBoost, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Gaussian blur (separable)
  const sigma = blurAmount;
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let kSum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    kSum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  // Horizontal pass
  const temp = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const si = getBufferIndex(nx, y, W);
        const w = kernel[k + radius];
        r += buf[si] * w; g += buf[si + 1] * w; b += buf[si + 2] * w; a += buf[si + 3] * w;
      }
      const idx = (y * W + x) * 4;
      temp[idx] = r; temp[idx + 1] = g; temp[idx + 2] = b; temp[idx + 3] = a;
    }
  }

  // Vertical pass
  const blurred = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const idx = (ny * W + x) * 4;
        const w = kernel[k + radius];
        r += temp[idx] * w; g += temp[idx + 1] * w; b += temp[idx + 2] * w; a += temp[idx + 3] * w;
      }
      const idx = (y * W + x) * 4;
      blurred[idx] = r; blurred[idx + 1] = g; blurred[idx + 2] = b; blurred[idx + 3] = a;
    }
  }

  // Render: blend original and blurred based on focus band
  const outBuf = new Uint8ClampedArray(buf.length);
  const focusCenter = H * focusPosition;
  const bandHalf = H * focusWidth / 2;
  const transitionZone = H * 0.3;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const bIdx = (y * W + x) * 4;

      const dist = Math.abs(y - focusCenter);
      const t = dist < bandHalf ? 0 : smoothstep(0, 1, (dist - bandHalf) / transitionZone);

      let r = Math.round(buf[i] * (1 - t) + blurred[bIdx] * t);
      let g = Math.round(buf[i + 1] * (1 - t) + blurred[bIdx + 1] * t);
      let b = Math.round(buf[i + 2] * (1 - t) + blurred[bIdx + 2] * t);

      // Saturation boost for miniature effect
      if (saturationBoost > 0) {
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = Math.max(0, Math.min(255, Math.round(gray + (r - gray) * (1 + saturationBoost))));
        g = Math.max(0, Math.min(255, Math.round(gray + (g - gray) * (1 + saturationBoost))));
        b = Math.max(0, Math.min(255, Math.round(gray + (b - gray) * (1 + saturationBoost))));
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Tilt Shift",
  func: tiltShiftFilter,
  optionTypes,
  options: defaults,
  defaults
});
