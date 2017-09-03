// @flow

import { BOOL, RANGE } from "constants/controlTypes";

import { nearest } from "palettes";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  quantizeValue
} from "utils";

export const optionTypes = {
  levels: { type: RANGE, range: [0, 255], default: 2 },
  grayscale: { type: BOOL, default: false }
};

export const defaults = {
  levels: optionTypes.levels.default,
  grayscale: optionTypes.grayscale.default
};

const random = (
  input: HTMLCanvasElement,
  options: { levels: number, grayscale: boolean } = defaults
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

      if (options.grayscale) {
        const intensity = (buf[i] + buf[i + 1] + buf[2]) / 3;
        const gray = quantizeValue(
          intensity + (Math.random() - 0.5) * 255,
          options.levels
        );
        fillBufferPixel(buf, i, gray, gray, gray, buf[i + 3]);
      } else {
        const r = buf[i] + (Math.random() - 0.5) * 255;
        const g = buf[i + 1] + (Math.random() - 0.5) * 255;
        const b = buf[i + 2] + (Math.random() - 0.5) * 255;
        const color = nearest.getColor(rgba(r, g, b, buf[i + 3]), {
          levels: options.levels
        });
        fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  func: random,
  options: defaults,
  optionTypes,
  defaults
};
