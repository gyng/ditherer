import { cloneCanvas, fillBufferPixel, getBufferIndex, linearizeBuffer, delinearizeBuffer } from "utils";

export const optionTypes = {};

export const defaults = {};

const grayscale = (input, options = {}) => {
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  if (options._linearize) linearizeBuffer(buf);

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const grey = options._linearize
        ? Math.round(0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2])
        : Math.round((buf[i] + buf[i + 1] + buf[i + 2]) / 3);
      fillBufferPixel(buf, i, grey, grey, grey, buf[i + 3]);
    }
  }

  if (options._linearize) delinearizeBuffer(buf);
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
