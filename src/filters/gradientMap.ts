import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
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
  color1: { type: COLOR, default: [0, 0, 40], desc: "Shadow color (darkest tones)" },
  color2: { type: COLOR, default: [200, 50, 50], desc: "Midtone color" },
  color3: { type: COLOR, default: [255, 220, 100], desc: "Highlight color (brightest tones)" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Blend with original image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  color3: optionTypes.color3.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const gradientMap = (input, options = defaults) => {
  const { color1, color2, color3, mix, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i], g = buf[i + 1], b = buf[i + 2], a = buf[i + 3];

      // Perceptual luminance 0-1
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      // Piecewise linear interpolation: 0→color1, 0.5→color2, 1→color3
      let mr, mg, mb;
      if (lum < 0.5) {
        const t = lum * 2;
        mr = lerp(color1[0], color2[0], t);
        mg = lerp(color1[1], color2[1], t);
        mb = lerp(color1[2], color2[2], t);
      } else {
        const t = (lum - 0.5) * 2;
        mr = lerp(color2[0], color3[0], t);
        mg = lerp(color2[1], color3[1], t);
        mb = lerp(color2[2], color3[2], t);
      }

      // Blend with original
      const fr = Math.round(lerp(r, mr, mix));
      const fg = Math.round(lerp(g, mg, mix));
      const fb = Math.round(lerp(b, mb, mix));

      const color = paletteGetColor(palette, rgba(fr, fg, fb, a), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Gradient Map",
  func: gradientMap,
  optionTypes,
  options: defaults,
  defaults
});
