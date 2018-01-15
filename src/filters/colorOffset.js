// @flow

import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const optionTypes = {
  rOffsetX: { type: RANGE, range: [0, 100], default: 10 },
  rOffsetY: { type: RANGE, range: [0, 100], default: 0 },
  rOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1 },
  gOffsetX: { type: RANGE, range: [0, 100], default: 0 },
  gOffsetY: { type: RANGE, range: [0, 100], default: 5 },
  gOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1 },
  bOffsetX: { type: RANGE, range: [0, 100], default: 8 },
  bOffsetY: { type: RANGE, range: [0, 100], default: 4 },
  bOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1 },
  aOffsetX: { type: RANGE, range: [0, 100], default: 0 },
  aOffsetY: { type: RANGE, range: [0, 100], default: 0 },
  aOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  rOffsetX: optionTypes.rOffsetX.default,
  rOffsetY: optionTypes.rOffsetY.default,
  rOpacity: optionTypes.rOpacity.default,
  gOffsetX: optionTypes.gOffsetX.default,
  gOffsetY: optionTypes.gOffsetY.default,
  gOpacity: optionTypes.gOpacity.default,
  bOffsetX: optionTypes.bOffsetX.default,
  bOffsetY: optionTypes.bOffsetY.default,
  bOpacity: optionTypes.bOpacity.default,
  aOffsetX: optionTypes.aOffsetX.default,
  aOffsetY: optionTypes.aOffsetY.default,
  aOpacity: optionTypes.aOpacity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorOffset = (
  input: HTMLCanvasElement,
  options: {
    rOffsetX: number,
    rOffsetY: number,
    rOpacity: number,
    gOffsetX: number,
    gOffsetY: number,
    gOpacity: number,
    bOffsetX: number,
    bOffsetY: number,
    bOpacity: number,
    aOffsetX: number,
    aOffsetY: number,
    aOpacity: number,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const {
    rOffsetX,
    rOffsetY,
    rOpacity,
    gOffsetX,
    gOffsetY,
    gOpacity,
    bOffsetX,
    bOffsetY,
    bOpacity,
    aOffsetX,
    aOffsetY,
    aOpacity,
    palette
  } = options;

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

      const rX = rOffsetX + x;
      const rY = rOffsetY + y;
      const rI = getBufferIndex(rX, rY, input.width);

      const gX = gOffsetX + x;
      const gY = gOffsetY + y;
      const gI = getBufferIndex(gX, gY, input.width);

      const bX = bOffsetX + x;
      const bY = bOffsetY + y;
      const bI = getBufferIndex(bX, bY, input.width);

      const aX = aOffsetX + x;
      const aY = aOffsetY + y;
      const aI = getBufferIndex(aX, aY, input.width);

      const pixel = rgba(buf[rI], buf[gI + 1], buf[bI + 2], buf[aI + 3]);
      const color = palette.getColor(pixel, palette.options);
      fillBufferPixel(
        buf,
        i,
        color[0] * rOpacity,
        color[1] * gOpacity,
        color[2] * bOpacity,
        color[3] * aOpacity
      );
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "ColorOffset",
  func: colorOffset,
  options: defaults,
  optionTypes,
  defaults
};
