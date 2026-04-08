import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  bits: { type: RANGE, range: [1, 8], step: 1, default: 3 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bits: optionTypes.bits.default,
  palette: optionTypes.palette.default
};

const bitCrush = (input, options = defaults) => {
  const { bits, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const levels = 2 ** bits;
  const step = 255 / (levels - 1);

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const r = Math.round(Math.round(buf[i] / step) * step);
      const g = Math.round(Math.round(buf[i + 1] / step) * step);
      const b = Math.round(Math.round(buf[i + 2] / step) * step);
      const col = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, options._linearize);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Bit crush",
  func: bitCrush,
  options: defaults,
  optionTypes,
  defaults
};
