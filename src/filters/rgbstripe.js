// @flow

import { BOOL, ENUM, RANGE, PALETTE } from "constants/controlTypes";
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

export const VERTICAL = "VERTICAL";
export const STAGGERED = "STAGGERED";
export const LADDER = "LADDER";
export const TILED = "TILED";
export const HEX_GAP = "HEX_GAP";

export type Mask = "VERTICAL" | "STAGGERED" | "LADDER" | "TILED" | "HEX_GAP";

const masks: { [Mask]: (e: number) => Array<Array<Array<number>>> } = {
  // R G B
  [VERTICAL]: e => [[[1, e, e, 1], [e, 1, e, 1], [e, e, 1, 1]]],
  // R_G_B_
  // _B_R_G
  [STAGGERED]: e => {
    const r = [0.9, e, e, 1];
    const r2 = [0.8, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [[r, k, g, k, b, k], [k, b, k, r2, k, g]];
  },
  // G B R
  // B R G
  // R G B
  [LADDER]: e => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];

    return [[r, g, b], [g, b, r], [b, r, g]];
  },
  // R G B R G B
  // R G B _ _ _
  // R G B R G B
  // _ _ _ R G B
  [TILED]: e => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [
      [r, g, b, r, g, b],
      [r, g, b, k, k, k],
      [r, g, b, r, g, b],
      [k, k, k, r, g, b]
    ];
  },
  // R G B _ R G B _
  // B _ R G B _ R G
  // R G B _ R G B _
  [HEX_GAP]: e => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [[r, g, b, k], [b, k, r, g]];
  }
};

export const optionTypes = {
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: 4 },
  strength: { type: RANGE, range: [-1, 1], step: 0.1, default: 0.6 },
  brightness: { type: RANGE, range: [-255, 255], step: 1, default: 40 },
  exposure: { type: RANGE, range: [0, 4], step: 0.1, default: 1.9 },
  includeScanline: { type: BOOL, default: true },
  scanlineStrength: { type: RANGE, range: [-2, 2], step: 0.05, default: 0.75 },
  shadowMask: {
    type: ENUM,
    options: [
      { name: "Vertical", value: VERTICAL },
      { name: "Staggered", value: STAGGERED },
      { name: "Ladder", value: LADDER },
      { name: "Tiled", value: TILED },
      { name: "Hex", value: HEX_GAP }
    ],
    default: HEX_GAP
  },
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
  shadowMask: optionTypes.shadowMask.default,
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
    scanlineStrength: number,
    shadowMask: Mask,
    blur: boolean,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const {
    includeScanline,
    scanlineStrength,
    shadowMask,
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
  const mask = masks[shadowMask](effect);

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);

      // Mask R/G/B alternating
      const maskxIdx = x % mask[0].length;
      const maskyIdx = y % mask.length;
      const masked = rgba(
        buf[i] * mask[maskyIdx][maskxIdx][0],
        buf[i + 1] * mask[maskyIdx][maskxIdx][1],
        buf[i + 2] * mask[maskyIdx][maskxIdx][2],
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
