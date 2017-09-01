// @flow

import { RANGE } from "constants/controlTypes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  quantize as quantizeColor
} from "./util";

export const optionTypes = {
  levels: { type: RANGE, range: [0, 255], default: 8 }
};

const quanitze = (
  input: HTMLCanvasElement,
  options: { levels: number } = { levels: optionTypes.levels.default }
): HTMLCanvasElement => {
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
      const color = quantizeColor(pixel, options.levels);
      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default quanitze;
