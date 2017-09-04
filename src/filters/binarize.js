// @flow

import { RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], default: 127.5 },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  palette: optionTypes.palette.default
};

const binarize = (
  input: HTMLCanvasElement,
  options: { threshold: number, palette: Palette } = defaults
): HTMLCanvasElement => {
  const { threshold, palette } = options;
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
      const intensity = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      const raw = intensity > threshold ? 255 : 0;
      const prePaletteCol = rgba(raw, raw, raw, buf[i + 3]);
      const col = palette.getColor(prePaletteCol, palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Binarize",
  func: binarize,
  optionTypes,
  options: defaults,
  defaults
};
