import { BOOL, RANGE, COLOR_DISTANCE_ALGORITHM } from "constants/controlTypes";
import { RGB_NEAREST } from "constants/color";

import { nearest } from "palettes";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  quantizeValue,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf
} from "utils";

export const optionTypes = {
  levels: { type: RANGE, range: [0, 255], default: 2 },
  grayscale: { type: BOOL, default: false },
  colorDistanceAlgorithm: COLOR_DISTANCE_ALGORITHM
};

export const defaults = {
  levels: optionTypes.levels.default,
  grayscale: optionTypes.grayscale.default,
  colorDistanceAlgorithm: RGB_NEAREST
};

const random = (
  input,
  options = defaults
) => {
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);

        if (options.grayscale) {
          const intensity = (floatBuf[i] + floatBuf[i + 1] + floatBuf[i + 2]) / 3;
          const gray255 = quantizeValue(
            intensity * 255 + (Math.random() - 0.5) * 255,
            options.levels
          );
          const grayF = gray255 / 255;
          fillBufferPixel(floatBuf, i, grayF, grayF, grayF, floatBuf[i + 3]);
        } else {
          const r = floatBuf[i] * 255 + (Math.random() - 0.5) * 255;
          const g = floatBuf[i + 1] * 255 + (Math.random() - 0.5) * 255;
          const b = floatBuf[i + 2] * 255 + (Math.random() - 0.5) * 255;
          const color = nearest.getColor(rgba(r, g, b, floatBuf[i + 3] * 255), {
            levels: options.levels,
            colorDistanceAlgorithm: options.colorDistanceAlgorithm
          });
          fillBufferPixel(floatBuf, i, color[0] / 255, color[1] / 255, color[2] / 255, floatBuf[i + 3]);
        }
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);

        if (options.grayscale) {
          const intensity = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
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
            levels: options.levels,
            colorDistanceAlgorithm: options.colorDistanceAlgorithm
          });
          fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Random",
  func: random,
  options: defaults,
  optionTypes,
  defaults
};
