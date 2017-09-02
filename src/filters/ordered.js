// @flow

import { ENUM, RANGE, PALETTE } from "constants/controlTypes";
import { nearest, ega } from "palettes";

import type { ColorRGBA, Palette } from "types";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  scaleMatrix
} from "utils";

const BAYER_2X2 = "BAYER_2X2";
const BAYER_3X3 = "BAYER_3X3";
const BAYER_4X4 = "BAYER_4X4";
const BAYER_8X8 = "BAYER_8X8";

export type Threshold = "BAYER_2X2" | "BAYER_3X3" | "BAYER_4X4" | "BAYER_8X8";

// map[y][x]
const thresholdMaps = {
  [BAYER_2X2]: {
    width: 2,
    thresholdMap: scaleMatrix([[0, 2], [3, 1]], 1 / 4)
  },
  [BAYER_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix([[0, 7, 3], [6, 5, 2], [4, 1, 8]], 1 / 9)
  },
  [BAYER_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
      1 / 16
    )
  },
  [BAYER_8X8]: {
    width: 8,
    thresholdMap: scaleMatrix(
      [
        [0, 48, 12, 60, 3, 51, 15, 63],
        [32, 16, 44, 28, 35, 19, 47, 31],
        [8, 56, 4, 52, 11, 59, 7, 55],
        [40, 24, 36, 20, 43, 27, 39, 23],
        [2, 50, 14, 62, 1, 49, 13, 61],
        [34, 18, 46, 30, 33, 17, 45, 29],
        [10, 58, 6, 54, 9, 57, 5, 53],
        [42, 26, 38, 22, 41, 25, 37, 21]
      ],
      1 / 64
    )
  }
};

const getOrderedColor = (
  color: ColorRGBA,
  levels: number,
  tx: number,
  ty: number,
  threshold: [number[]]
): ColorRGBA => {
  const thresholdValue = threshold[ty][tx];
  const step = 255 / (levels - 1);

  // $FlowFixMe
  return color.map(c => {
    const newColor = c + step * (thresholdValue - 0.5);
    const bucket = Math.round(newColor / step);
    return Math.round(bucket * step);
  });
};

export const optionTypes = {
  thresholdMap: {
    type: ENUM,
    options: [
      {
        name: "Bayer 2×2",
        value: BAYER_2X2
      },
      {
        name: "Bayer 3×3",
        value: BAYER_3X3
      },
      {
        name: "Bayer 4×4",
        value: BAYER_4X4
      },
      {
        name: "Bayer 8×8",
        value: BAYER_8X8
      }
    ],
    default: BAYER_4X4
  },
  palette: { type: PALETTE, default: nearest }
};

const defaults = {
  thresholdMap: optionTypes.thresholdMap.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const ordered = (
  input: HTMLCanvasElement,
  options: {
    thresholdMap: Threshold,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const { palette, thresholdMap } = options;
  const levels = palette.options.levels || 2;

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const threshold = thresholdMaps[thresholdMap];

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const tix = x % threshold.width;
      const tiy = y % threshold.width;
      const i = getBufferIndex(x, y, input.width);

      // Ignore alpha channel when calculating error
      const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      const orderedColor = getOrderedColor(
        pixel,
        levels,
        tix,
        tiy,
        threshold.thresholdMap
      );
      const color = palette.getColor(orderedColor, palette.options);

      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default ordered;
