// @flow

import { nearest } from "palettes";
import { cloneCanvas } from "utils";

import convolve, {
  GAUSSIAN_3X3_WEAK,
  defaults as convolveDefaults
} from "./convolve";

import jitter, {
  defaults as jitterDefaults,
  optionTypes as jitterOptionTypes
} from "./jitter";

import brightnessContrast, {
  defaults as brightnessContrastDefaults
} from "./brightnessContrast";

import channelSeparation, {
  defaults as channelSeparationDefaults
} from "./channelSeparation";

export const optionTypes = {
  jitterX: jitterOptionTypes.jitterX,
  jitterXSpread: jitterOptionTypes.jitterXSpread
};

export const defaults = {
  jitterX: 1,
  jitterXSpread: jitterDefaults.jitterXSpread
};

const vhs = (
  input: HTMLCanvasElement,
  options: {
    jitterX: number,
    jitterXSpread: number
  } = defaults
): HTMLCanvasElement => {
  const { jitterX, jitterXSpread } = options;

  let output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  output = jitter.func(input, { ...jitterDefaults, jitterX, jitterXSpread });

  output = brightnessContrast.func(output, {
    ...brightnessContrastDefaults,
    brightness: 60,
    contrast: -0.2,
    exposure: 0.7,
    gamma: 0.6,
    palette: { ...nearest, options: { levels: 255 } }
  });
  output = channelSeparation.func(output, {
    ...channelSeparationDefaults,
    rOffsetX: 2,
    rOffsetY: 2,
    gOffsetX: 2,
    gOffsetY: 1,
    bOffsetX: 2,
    bOffsetY: 1
  });
  output = convolve.func(output, {
    ...convolveDefaults,
    kernel: GAUSSIAN_3X3_WEAK
  });

  return output;
};

export default {
  name: "VHS emulation",
  func: vhs,
  options: defaults,
  optionTypes,
  defaults
};
