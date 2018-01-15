// @flow

import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const optionTypes = {
  jitterX: { type: RANGE, range: [0, 100], default: 4 },
  jitterXSpread: { type: RANGE, range: [0, 5], default: 0.5, step: 0.1 },
  jitterY: { type: RANGE, range: [0, 100], default: 0 },
  jitterYSpread: { type: RANGE, range: [0, 5], default: 0.5, step: 0.1 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  jitterX: optionTypes.jitterX.default,
  jitterXSpread: optionTypes.jitterXSpread.default,
  jitterY: optionTypes.jitterY.default,
  jitterYSpread: optionTypes.jitterYSpread.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const jittter = (
  input: HTMLCanvasElement,
  options: {
    jitterX: number,
    jitterXSpread: number,
    jitterY: number,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const { jitterX, jitterXSpread, jitterY, jitterYSpread, palette } = options;

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const jitterYMap = [];
  const jitterXMap = [];

  let jitterFactor = 0;
  for (let i = 0; i < input.width; i += 1) {
    const jitter = Math.random() * jitterY;
    jitterFactor += jitter;
    jitterYMap.push(Math.round(jitterFactor));
    jitterFactor *= jitterYSpread;
  }

  jitterFactor = 0;
  for (let i = 0; i < input.width; i += 1) {
    const jitter = Math.random() * jitterX;
    jitterFactor += jitter;
    jitterXMap.push(Math.round(jitterFactor));
    jitterFactor *= jitterXSpread;
  }

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const jI = getBufferIndex(
        (x + jitterYMap[x]) % input.width,
        (y + jitterXMap[y]) % input.height,
        input.width
      );

      const pixel = rgba(buf[jI], buf[jI + 1], buf[jI + 2], buf[jI + 3]);
      const color = palette.getColor(pixel, palette.options);
      fillBufferPixel(buf, i, color[0], color[1], color[2], color[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Jitter",
  func: jittter,
  options: defaults,
  optionTypes,
  defaults
};
