// @flow

import { ENUM, PALETTE, RANGE } from "@src/constants/controlTypes";
import { nearest } from "@src/palettes";

import type { ColorRGBA, Palette } from "@src/types";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  scaleMatrix,
} from "@src/util";

export const BAYER_2X2 = "BAYER_2X2";
export const BAYER_3X3 = "BAYER_3X3";
export const BAYER_4X4 = "BAYER_4X4";
export const BAYER_8X8 = "BAYER_8X8";
export const BAYER_16X16 = "BAYER_16X16";
export const SQUARE_5X5 = "SQUARE_5X5";
export const CORNER_4X4 = "CORNER_4X4";
export const BLOCK_VERTICAL_4X4 = "BLOCK_VERTICAL_4X4";
export const BLOCK_HORIZONTAL_4X4 = "BLOCK_HORIZONTAL_4X4";
export const HATCH_2X2 = "HATCH_2X2";
export const HATCH_3X3 = "HATCH_3X3";
export const HATCH_4X4 = "HATCH_4X4";
export const ALTERNATE_3X3 = "ALTERNATE_3X3";
export const DISPERSED_DOT_3X3 = "DISPERSED_DOT_3X3";
export const PATTERN_5X5 = "PATTERN_5X5";

export type Threshold =
  | "BAYER_2X2"
  | "BAYER_3X3"
  | "BAYER_4X4"
  | "BAYER_8X8"
  | "BAYER_16X16"
  | "SQUARE_5X5"
  | "DISPERSED_DOT_3X3"
  | "CORNER_4X4"
  | "BLOCK_VERTICAL_4X4"
  | "BLOCK_HORIZONTAL_4X4"
  | "HATCH_2X2"
  | "HATCH_3X3"
  | "HATCH_4X4"
  | "ALTERNATE_3X3"
  | "PATTERN_5X5";

// map[y][x]
const thresholdMaps: {
  [k in Threshold]: {
    width: number;
    thresholdMap: Array<Array<number | null | undefined>>;
    levels?: number;
  };
} = {
  [BAYER_2X2]: {
    width: 2,
    thresholdMap: scaleMatrix(
      [
        [0, 2],
        [3, 1],
      ],
      1 / 4
    ),
  },
  [BAYER_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix(
      [
        [0, 7, 3],
        [6, 5, 2],
        [4, 1, 8],
      ],
      1 / 9
    ),
  },
  [BAYER_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
      ],
      1 / 16
    ),
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
        [42, 26, 38, 22, 41, 25, 37, 21],
      ],
      1 / 64
    ),
  },
  [BAYER_16X16]: {
    width: 16,
    thresholdMap: scaleMatrix(
      // prettier-ignore
      [
        [   0,192, 48,240, 12,204, 60,252,  3,195, 51,243, 15,207, 63,255 ],
        [ 128, 64,176,112,140, 76,188,124,131, 67,179,115,143, 79,191,127 ],
        [  32,224, 16,208, 44,236, 28,220, 35,227, 19,211, 47,239, 31,223 ],
        [ 160, 96,144, 80,172,108,156, 92,163, 99,147, 83,175,111,159, 95 ],
        [   8,200, 56,248,  4,196, 52,244, 11,203, 59,251,  7,199, 55,247 ],
        [ 136, 72,184,120,132, 68,180,116,139, 75,187,123,135, 71,183,119 ],
        [  40,232, 24,216, 36,228, 20,212, 43,235, 27,219, 39,231, 23,215 ],
        [ 168,104,152, 88,164,100,148, 84,171,107,155, 91,167,103,151, 87 ],
        [   2,194, 50,242, 14,206, 62,254,  1,193, 49,241, 13,205, 61,253 ],
        [ 130, 66,178,114,142, 78,190,126,129, 65,177,113,141, 77,189,125 ],
        [  34,226, 18,210, 46,238, 30,222, 33,225, 17,209, 45,237, 29,221 ],
        [ 162, 98,146, 82,174,110,158, 94,161, 97,145, 81,173,109,157, 93 ],
        [  10,202, 58,250,  6,198, 54,246,  9,201, 57,249,  5,197, 53,245 ],
        [ 138, 74,186,122,134, 70,182,118,137, 73,185,121,133, 69,181,117 ],
        [  42,234, 26,218, 38,230, 22,214, 41,233, 25,217, 37,229, 21,213 ],
        [ 170,106,154, 90,166,102,150, 86,169,105,153, 89,165,101,149, 85]
      ],
      1 / 256
    ),
  },
  [SQUARE_5X5]: {
    width: 5,
    thresholdMap: scaleMatrix(
      [
        [40, 60, 150, 90, 10],
        [80, 170, 240, 200, 110],
        [140, 210, 250, 220, 130],
        [120, 190, 230, 180, 70],
        [20, 100, 160, 50, 30],
      ],
      1 / 255
    ),
  },
  [DISPERSED_DOT_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix(
      [
        [0, 6, 3],
        [4, 7, 2],
        [5, 1, 8],
      ],
      1 / 9
    ),
  },
  [CORNER_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [
        [0, 2, 5, 9],
        [1, 4, 8, 12],
        [3, 7, 11, 14],
        [6, 10, 13, 15],
      ],
      1 / 16
    ),
  },
  [BLOCK_VERTICAL_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
      ],
      1 / 4
    ),
    levels: 4,
  },
  [BLOCK_HORIZONTAL_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [2, 2, 2, 2],
        [3, 3, 3, 3],
      ],
      1 / 4
    ),
    levels: 4,
  },
  [HATCH_2X2]: {
    width: 2,
    thresholdMap: scaleMatrix(
      [
        [0, 1],
        [1, 0],
      ],
      1 / 2
    ),
    levels: 2,
  },
  [HATCH_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix(
      [
        [0, 1, 2],
        [1, 2, 1],
        [2, 1, 0],
      ],
      1 / 3
    ),
    levels: 3,
  },
  [HATCH_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [
        [0, 1, 2, 3],
        [1, 2, 3, 2],
        [2, 3, 2, 1],
        [3, 2, 1, 0],
      ],
      1 / 4
    ),
    levels: 4,
  },
  [ALTERNATE_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix(
      [
        [0, 5, 1],
        [6, 2, 7],
        [3, 8, 4],
      ],
      1 / 9
    ),
    levels: 9,
  },
  [PATTERN_5X5]: {
    width: 5,
    thresholdMap: scaleMatrix(
      [
        [2, 4, 2, 4, 2],
        [4, 1, 3, 1, 4],
        [2, 3, 0, 3, 2],
        [4, 1, 3, 1, 4],
        [2, 4, 2, 4, 2],
      ],
      1 / 5
    ),
    levels: 5,
  },
};

const scaleThresholdMap = (
  map: Array<Array<number | null | undefined>>,
  timesX: number,
  timesY: number
): Array<Array<number | null | undefined>> => {
  if (timesX === 1 && timesY === 1) {
    return map;
  }

  const out = [];

  for (let i = 0; i < map.length; i += 1) {
    for (let y = 0; y < timesY; y += 1) {
      const row = [];

      for (let j = 0; j < map[i].length; j += 1) {
        for (let x = 0; x < timesX; x += 1) {
          row.push(map[i][j]);
        }
      }
      out.push(row);
    }
  }

  return out;
};

const getOrderedColor = (
  color: ColorRGBA,
  levels: number,
  tx: number,
  ty: number,
  threshold: Array<Array<number | null | undefined>>
): ColorRGBA => {
  const thresholdValue = threshold[ty][tx];

  if (thresholdValue == null) {
    return rgba(255, 255, 0, 255); // error colour
  }

  const step = 255 / (levels - 1);

  return color.map((c, i) => {
    if (i === 3) return c; // alpha channel
    const newColor = c + step * (thresholdValue - 0.5);
    const bucket = Math.round(newColor / step);
    return Math.round(bucket * step);
  }) as ColorRGBA;
};

export const optionTypes = {
  thresholdMap: {
    type: ENUM,
    options: [
      {
        name: "Bayer 2×2",
        value: BAYER_2X2,
      },
      {
        name: "Bayer 3×3",
        value: BAYER_3X3,
      },
      {
        name: "Bayer 4×4",
        value: BAYER_4X4,
      },
      {
        name: "Bayer 8×8",
        value: BAYER_8X8,
      },
      {
        name: "Bayer 16×16",
        value: BAYER_16X16,
      },
      {
        name: "Dispersed Dot 3×3",
        value: DISPERSED_DOT_3X3,
      },
      {
        name: "Digital Halftone 5×8",
        value: SQUARE_5X5,
      },
      {
        name: "Corner 4×4",
        value: CORNER_4X4,
      },
      {
        name: "Block Vertical 4×4",
        value: BLOCK_VERTICAL_4X4,
      },
      {
        name: "Block Horizontal 4×4",
        value: BLOCK_HORIZONTAL_4X4,
      },
      {
        name: "Hatch 2×2",
        value: HATCH_2X2,
      },
      {
        name: "Hatch 3×3",
        value: HATCH_3X3,
      },
      {
        name: "Hatch 4×4",
        value: HATCH_4X4,
      },
      {
        name: "Alternate 3×3",
        value: ALTERNATE_3X3,
      },
      {
        name: "Hatch 2×2 ×3",
        value: PATTERN_5X5,
      },
    ],
    default: HATCH_2X2,
  },
  thresholdMapScaleX: { type: RANGE, range: [1, 5], step: 1, default: 1 },
  thresholdMapScaleY: { type: RANGE, range: [1, 5], step: 1, default: 1 },
  palette: { type: PALETTE, default: nearest },
};

const defaults = {
  thresholdMap: optionTypes.thresholdMap.default,
  thresholdMapScaleX: optionTypes.thresholdMapScaleX.default,
  thresholdMapScaleY: optionTypes.thresholdMapScaleY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } },
};

const ordered = (
  input: HTMLCanvasElement,
  // @ts-ignore
  options: {
    thresholdMap: Threshold;
    thresholdMapScaleX: number;
    thresholdMapScaleY: number;
    palette: Palette;
  } = defaults
): HTMLCanvasElement => {
  const {
    palette,
    thresholdMap,
    thresholdMapScaleX,
    thresholdMapScaleY,
  } = options;

  const levels =
    thresholdMap.length > 0 ? thresholdMap.length * thresholdMap[0].length : 4;

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const threshold = thresholdMaps[thresholdMap as Threshold];
  const thresholdMapScaled = scaleThresholdMap(
    threshold.thresholdMap,
    thresholdMapScaleX,
    thresholdMapScaleY
  );
  const thresholdMapWidth = threshold.width * thresholdMapScaleX;
  const thresholdMapHeight = threshold.width * thresholdMapScaleY;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const tix = x % thresholdMapWidth;
      const tiy = y % thresholdMapHeight;
      const i = getBufferIndex(x, y, input.width);

      // Ignore alpha channel when calculating error
      const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      const orderedColor = getOrderedColor(
        pixel,
        levels,
        tix,
        tiy,
        thresholdMapScaled
      );
      const color = palette.getColor(orderedColor, palette.options);

      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Ordered",
  func: ordered,
  options: defaults,
  optionTypes,
  defaults,
};
