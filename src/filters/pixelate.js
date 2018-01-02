// @flow

import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const optionTypes = {
  scale: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.33 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const pixelate = (
  input: HTMLCanvasElement,
  options: { scale: number, palette: Palette }
): HTMLCanvasElement => {
  const { scale, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const temp = document.createElement("canvas");
  temp.width = input.width * scale;
  temp.height = input.height * scale;
  const tempCtx = temp.getContext("2d");
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(input, 0, 0, input.width * scale, input.height * scale);

  const buf = tempCtx.getImageData(0, 0, temp.width, temp.height).data;
  for (let x = 0; x < temp.width; x += 1) {
    for (let y = 0; y < temp.height; y += 1) {
      const i = getBufferIndex(x, y, temp.width);
      const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      const color = palette.getColor(pixel, palette.options);
      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  tempCtx.putImageData(new ImageData(buf, temp.width, temp.height), 0, 0);

  outputCtx.imageSmoothingEnabled = false;
  outputCtx.drawImage(temp, 0, 0, input.width, input.height);

  return output;
};

export default {
  name: "Pixelate",
  func: pixelate,
  options: defaults,
  optionTypes,
  defaults
};
