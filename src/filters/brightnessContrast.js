// @flow

import { RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  contrast as contrastFunc,
  brightness as brightnessFunc
} from "utils";

import type { Palette } from "types";

export const optionTypes = {
  brightness: { type: RANGE, range: [-255, 255], step: 1, default: 0 },
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: 0 },
  exposure: { type: RANGE, range: [-4, 4], step: 0.1, default: 1 },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  contrast: optionTypes.contrast.default,
  brightness: optionTypes.brightness.default,
  exposure: optionTypes.exposure.default,
  palette: optionTypes.palette.default
};

const brightnessContrast = (
  input: HTMLCanvasElement,
  options: {
    brightness: number,
    exposure: number,
    contrast: number,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const { brightness, contrast, exposure, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const outputBuf = new Uint8ClampedArray(buf);

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const newColor = contrastFunc(
        brightnessFunc(
          rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]),
          brightness,
          exposure
        ),
        contrast
      );

      const col = palette.getColor(newColor, palette.options);
      fillBufferPixel(outputBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(
    new ImageData(outputBuf, output.width, output.height),
    0,
    0
  );
  return output;
};

export default {
  name: "Brightness/Contrast",
  func: brightnessContrast,
  optionTypes,
  options: defaults,
  defaults
};
