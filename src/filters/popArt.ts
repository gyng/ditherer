import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Ben-Day dot size" },
  levels: { type: RANGE, range: [2, 8], step: 1, default: 4, desc: "Color posterization levels" },
  saturationBoost: { type: RANGE, range: [1, 3], step: 0.1, default: 2, desc: "Vivid color saturation multiplier" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  levels: optionTypes.levels.default,
  saturationBoost: optionTypes.saturationBoost.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const popArt = (input: any, options = defaults) => {
  const { dotSize, levels, saturationBoost, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Step 1: Boost saturation and posterize
  const step = 255 / (levels - 1);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];

      // Boost saturation
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = Math.max(0, Math.min(255, Math.round(gray + (r - gray) * saturationBoost)));
      g = Math.max(0, Math.min(255, Math.round(gray + (g - gray) * saturationBoost)));
      b = Math.max(0, Math.min(255, Math.round(gray + (b - gray) * saturationBoost)));

      // Posterize
      r = Math.round(Math.round(r / step) * step);
      g = Math.round(Math.round(g / step) * step);
      b = Math.round(Math.round(b / step) * step);

      // Ben-Day dots: luminance determines dot presence
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const cellX = x % dotSize;
      const cellY = y % dotSize;
      const cx = dotSize / 2;
      const dist = Math.sqrt((cellX - cx) * (cellX - cx) + (cellY - cx) * (cellY - cx));
      const dotR = (dotSize / 2) * (1 - lum); // darker = bigger dots

      if (dist < dotR) {
        const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      } else {
        // White background between dots
        fillBufferPixel(outBuf, i, 255, 255, 255, 255);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Pop Art", func: popArt, optionTypes, options: defaults, defaults });
