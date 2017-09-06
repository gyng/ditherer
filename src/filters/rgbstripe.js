// @flow

import { BOOL, RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  scale,
  contrast as contrastFunc,
  brightness as brightnessFunc
} from "utils";

import type { Palette } from "types";

import convolve, {
  GAUSSIAN_3X3_WEAK,
  defaults as convolveDefaults
} from "./convolve";

export const optionTypes = {
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: -5 },
  strength: { type: RANGE, range: [-1, 1], step: 0.1, default: 0.6 },
  brightness: { type: RANGE, range: [-255, 255], step: 1, default: 35 },
  exposure: { type: RANGE, range: [0, 4], step: 0.1, default: 1.4 },
  includeScanline: { type: BOOL, default: true },
  scanlineStrength: { type: RANGE, range: [-2, 2], step: 0.05, default: 0.5 },
  blur: { type: BOOL, default: true },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  brightness: optionTypes.brightness.default,
  exposure: optionTypes.exposure.default,
  includeScanline: optionTypes.includeScanline.default,
  scanlineStrength: optionTypes.scanlineStrength.default,
  blur: optionTypes.blur.default,
  palette: optionTypes.palette.default
};

const rgbStripe = (
  input: HTMLCanvasElement,
  options: {
    strength: number,
    brightness: number,
    exposure: number,
    contrast: number,
    includeScanline: boolean,
    scanlineStrength: 0.5,
    blur: boolean,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const {
    includeScanline,
    scanlineStrength,
    brightness,
    contrast,
    exposure,
    strength,
    blur,
    palette
  } = options;
  let output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const outputBuf = new Uint8ClampedArray(buf);
  const effect = 1 - strength;
  const mask = [
    [1, effect, effect, 1],
    [effect, 1, effect, 1],
    [effect, effect, 1, 1]
  ];

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);

      // Mask R/G/B alternating
      const maskIdx = x % 3;
      const masked = rgba(
        buf[i] * mask[maskIdx][0],
        buf[i + 1] * mask[maskIdx][1],
        buf[i + 2] * mask[maskIdx][2],
        buf[i + 3]
      );

      // Bring up brightness as we've masked off too much
      const brightnessAdjusted = brightnessFunc(masked, brightness, exposure);
      const contrastAdjusted = contrastFunc(brightnessAdjusted, contrast);

      // Manually scanline if needed
      const scanlineScale =
        includeScanline && y % 3 === 0 ? scanlineStrength : 1;
      const scanlined = scale(contrastAdjusted, scanlineScale);

      const color = palette.getColor(scanlined, palette.options);

      fillBufferPixel(outputBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(
    new ImageData(outputBuf, output.width, output.height),
    0,
    0
  );

  if (blur) {
    output = convolve.func(output, {
      ...convolveDefaults,
      kernel: GAUSSIAN_3X3_WEAK
    });
  }

  return output;
};

export default {
  name: "rgbStripe",
  func: rgbStripe,
  optionTypes,
  options: defaults,
  defaults
};
