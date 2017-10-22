// @flow

import { RANGE, COLOR_DISTANCE_ALGORITHM } from "constants/controlTypes";
import { RGB_NEAREST } from "constants/color";
import { colorDistance } from "utils";

import type { ColorRGBA, ColorDistanceAlgorithm } from "types";

const optionTypes = {
  levels: { type: RANGE, range: [1, 256], default: 2 },
  colorDistanceAlgorithm: COLOR_DISTANCE_ALGORITHM
};

const defaults = {
  levels: optionTypes.levels.default,
  colorDistanceAlgorithm: RGB_NEAREST
};

const palettesMemo = {};

const makePalette = (levels: number) => {
  palettesMemo[levels] = [];
  const step = 255 / (levels - 1);
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < levels; j += 1) {
      for (let k = 0; k < levels; k += 1) {
        for (let l = 0; l < levels; l += 1) {
          palettesMemo[levels].push([
            Math.floor(i * step),
            Math.floor(j * step),
            Math.floor(k * step),
            Math.floor(l * step)
          ]);
        }
      }
    }
  }
};

// Gets nearest color
const getColor = (
  color: ColorRGBA,
  options: {
    levels: number,
    colorDistanceAlgorithm: ColorDistanceAlgorithm
  } = defaults
): ColorRGBA => {
  const { levels, colorDistanceAlgorithm } = options;

  if (typeof palettesMemo[levels] === "undefined") {
    makePalette(levels);
  }
  const palette = palettesMemo[levels];

  let min = null;
  let minDistance = 0;

  for (let i = 0; i < palette.length; i += 1) {
    const pc = palette[i];
    const distance = colorDistance(pc, color, colorDistanceAlgorithm);

    if (min === null) {
      min = pc;
      minDistance = distance;
    } else if (distance < minDistance) {
      min = pc;
      minDistance = distance;
    }
  }

  return !min ? color : min;
};

export default {
  name: "nearest",
  getColor,
  options: defaults,
  optionTypes,
  defaults
};
