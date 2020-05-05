// @flow

import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "@src/util";
import { RANGE, PALETTE } from "@src/constants/controlTypes";
import * as palettes from "@src/palettes";

import type { Palette } from "@src/types";

export const optionTypes = {
  thresholdR: { type: RANGE, range: [0, 255], step: 0.5, default: 127.5 },
  thresholdG: { type: RANGE, range: [0, 255], step: 0.5, default: 127.5 },
  thresholdB: { type: RANGE, range: [0, 255], step: 0.5, default: 127.5 },
  thresholdA: { type: RANGE, range: [0, 255], step: 0.5, default: 0 },
  palette: { type: PALETTE, default: palettes.nearest },
};

export const defaults = {
  thresholdR: optionTypes.thresholdR.default,
  thresholdG: optionTypes.thresholdG.default,
  thresholdB: optionTypes.thresholdB.default,
  thresholdA: optionTypes.thresholdA.default,
  palette: optionTypes.palette.default,
};

const binarize = (
  input: HTMLCanvasElement,
  options: {
    thresholdR: number;
    thresholdG: number;
    thresholdB: number;
    thresholdA: number;
    palette: Palette;
  } = defaults
): HTMLCanvasElement => {
  const getColor = (val: number, threshold: number): number =>
    val > threshold ? 255 : 0;

  const { thresholdR, thresholdG, thresholdB, thresholdA, palette } = options;
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
      const prePaletteCol = rgba(
        getColor(buf[i], thresholdR),
        getColor(buf[i + 1], thresholdG),
        getColor(buf[i + 2], thresholdB),
        getColor(buf[i + 3], thresholdA)
      );
      const col = palette.getColor(prePaletteCol, palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
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
  defaults,
};
