// @flow

import { PALETTE } from "@src/constants/controlTypes";
import { nearest } from "@src/palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "@src/util";

import type { Palette } from "@src/types";

export const optionTypes = {
  palette: { type: PALETTE, default: nearest },
};

const defaults = {
  palette: { ...optionTypes.palette.default, options: { levels: 7 } },
};

const quantize = (
  input: HTMLCanvasElement,
  options: { palette: Palette } = defaults
): HTMLCanvasElement => {
  const { palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      const color = palette.getColor(pixel, palette.options);
      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Quantize",
  func: quantize,
  options: defaults,
  optionTypes,
  defaults,
};
