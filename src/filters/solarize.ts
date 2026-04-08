import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  palette: optionTypes.palette.default
};

const solarize = (input, options = defaults) => {
  const { threshold, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const r = buf[i] > threshold ? 255 - buf[i] : buf[i];
      const g = buf[i + 1] > threshold ? 255 - buf[i + 1] : buf[i + 1];
      const b = buf[i + 2] > threshold ? 255 - buf[i + 2] : buf[i + 2];
      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Solarize",
  func: solarize,
  options: defaults,
  optionTypes,
  defaults
};
