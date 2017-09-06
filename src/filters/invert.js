// @flow

import { BOOL } from "constants/controlTypes";
import { cloneCanvas, fillBufferPixel, getBufferIndex } from "utils";

export const optionTypes = {
  invertAlpha: { type: BOOL, default: false }
};

export const defaults = {
  invertAlpha: optionTypes.invertAlpha.default
};

const invert = (
  input: HTMLCanvasElement,
  options: { invertAlpha: boolean } = defaults
): HTMLCanvasElement => {
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const r = 255 - buf[i];
      const g = 255 - buf[i + 1];
      const b = 255 - buf[i + 2];
      const a = options.invertAlpha ? 255 - buf[i + 3] : buf[i + 3];
      fillBufferPixel(buf, i, r, g, b, a);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Invert",
  func: invert,
  options: defaults,
  optionTypes,
  defaults
};
