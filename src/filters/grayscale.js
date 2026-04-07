import { cloneCanvas, fillBufferPixel, getBufferIndex, srgbBufToLinearFloat, linearFloatToSrgbBuf } from "utils";

export const optionTypes = {};

export const defaults = {};

const grayscale = (input, options = {}) => {
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const grey = 0.2126 * floatBuf[i] + 0.7152 * floatBuf[i + 1] + 0.0722 * floatBuf[i + 2];
        fillBufferPixel(floatBuf, i, grey, grey, grey, floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const grey = Math.round((buf[i] + buf[i + 1] + buf[i + 2]) / 3);
        fillBufferPixel(buf, i, grey, grey, grey, buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Grayscale",
  func: grayscale,
  options: defaults,
  optionTypes,
  defaults
};
