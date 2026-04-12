import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Infrared effect strength" },
  falseColor: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "False-color mapping intensity" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  falseColor: optionTypes.falseColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const infrared = (input, options = defaults) => {
  const { intensity, falseColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const sr = buf[i], sg = buf[i + 1], sb = buf[i + 2];

      // IR film simulation:
      // - Green channel (foliage) becomes very bright (Wood effect)
      // - Blue/sky goes dark
      // - Red stays similar
      const irLum = sr * 0.3 + sg * 0.7 + sb * (-0.2);
      const irNorm = Math.max(0, Math.min(255, irLum));

      // False color IR: shift hues
      let r: number, g: number, b: number;
      if (falseColor > 0) {
        // Pink/magenta foliage, dark skies, warm tones
        r = Math.round(irNorm * 0.9 + sg * 0.3 * falseColor);
        g = Math.round(irNorm * 0.3 - sb * 0.2 * falseColor);
        b = Math.round(irNorm * 0.5 + sr * 0.2 * falseColor);
      } else {
        r = g = b = Math.round(irNorm);
      }

      // Blend with original
      r = Math.max(0, Math.min(255, Math.round(sr * (1 - intensity) + r * intensity)));
      g = Math.max(0, Math.min(255, Math.round(sg * (1 - intensity) + g * intensity)));
      b = Math.max(0, Math.min(255, Math.round(sb * (1 - intensity) + b * intensity)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Infrared", func: infrared, optionTypes, options: defaults, defaults });
