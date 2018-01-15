// @flow

import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const optionTypes = {
  jitterX: { type: RANGE, range: [0, 100], default: 5 },
  jitterY: { type: RANGE, range: [0, 100], default: 5 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  jitterX: optionTypes.jitterX.default,
  jitterY: optionTypes.jitterY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const channelSeparation = (
  input: HTMLCanvasElement,
  options: {
    jitterX: number,
    jitterY: number,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const { jitterX, jitterY, palette } = options;

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const jitterXMap = [];
  const jitterYMap = [];
  for (let i = 0; i < input.width; i += 1) {
    jitterXMap.push(Math.round(Math.random() * jitterX));
  }
  for (let i = 0; i < input.height; i += 1) {
    jitterYMap.push(Math.round(Math.random() * jitterY));
  }

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const jI = getBufferIndex(
        x + jitterXMap[x],
        y + jitterYMap[y],
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
  name: "Channel separation",
  func: channelSeparation,
  options: defaults,
  optionTypes,
  defaults
};
