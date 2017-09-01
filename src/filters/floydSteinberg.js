// @flow

import { RANGE } from "constants/controlTypes";

import type { ColorRGBA } from "types";

import {
  cloneCanvas,
  fillBufferPixel,
  addBufferPixel,
  getBufferIndex,
  rgba,
  sub,
  scale,
  quantize
} from "./util";

export const optionTypes = {
  levels: { type: RANGE, range: [0, 255], default: 2 }
};

const floydSteinberg = (
  input: HTMLCanvasElement,
  options: { levels: number } = { levels: optionTypes.levels.default }
): HTMLCanvasElement => {
  const output = cloneCanvas(input, true);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const buf = outputCtx.getImageData(0, 0, input.width, input.height).data;
  if (!buf) return input;
  // Increase precision over u8 (from getImageData) for error diffusion
  const errBuf = Array.from(buf);
  if (!errBuf) return input;

  for (let x = 0; x < output.width; x += 1) {
    for (let y = 0; y < output.height; y += 1) {
      const i: number = getBufferIndex(x, y, output.width);

      // Ignore alpha channel when calculating error
      const pixel = rgba(
        errBuf[i],
        errBuf[i + 1],
        errBuf[i + 2],
        errBuf[i + 3]
      );
      const color = quantize(pixel, options.levels);
      const error = sub(pixel, color);

      // Copy alpha value from input
      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);

      // Diffuse weighted error down diagonally right, following for loops
      // [_,    *,    7/16]
      // [3/16, 5/16, 1/16]
      const errorMatrix = [[0, 0, 7 / 16], [3 / 16, 5 / 16, 1 / 16]];

      const a = getBufferIndex(x + 1, y, output.width);
      const aError = scale(error, errorMatrix[0][2]);
      addBufferPixel(errBuf, a, aError);

      const b = getBufferIndex(x - 1, y + 1, output.width);
      const bError = scale(error, errorMatrix[1][0]);
      addBufferPixel(errBuf, b, bError);

      const c = getBufferIndex(x, y + 1, output.width);
      const cError = scale(error, errorMatrix[1][1]);
      addBufferPixel(errBuf, c, cError);

      const d = getBufferIndex(x + 1, y + 1, output.width);
      const dError = scale(error, errorMatrix[1][2]);
      addBufferPixel(errBuf, d, dError);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default floydSteinberg;
