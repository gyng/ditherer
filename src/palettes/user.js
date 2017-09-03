// @flow

import { COLOR_ARRAY } from "constants/controlTypes";

import { rgba } from "utils";

import type { ColorRGBA } from "types";

// https://en.wikipedia.org/wiki/List_of_8-bit_computer_hardware_palettes
// https://en.wikipedia.org/wiki/Color_Graphics_Adapter

const cga = {
  BLACK: rgba(0, 0, 0, 255), // 0 black
  BLUE: rgba(0, 0, 170, 255), // 1 blue
  GREEN: rgba(0, 170, 0, 255), // 2 green
  CYAN: rgba(0, 170, 170, 255), // 3 cyan
  RED: rgba(170, 0, 0, 255), // 4 red
  MAGENTA: rgba(170, 0, 170, 255), // 5 magenta
  YELLOW: rgba(170, 170, 0, 255), // 6 yellow
  WHITE: rgba(170, 170, 170, 255), // 7 white
  BBLACK: rgba(85, 85, 85, 255), // 8 bright black
  BBLUE: rgba(85, 85, 255, 255), // 9 bright blue
  BGREEN: rgba(85, 255, 85, 255), // 10 bright green
  BCYAN: rgba(85, 255, 255, 255), // 11 bright cyan
  BRED: rgba(255, 85, 85, 255), // 12 bright red
  BMAGENTA: rgba(255, 85, 255, 255), // 13 bright magenta
  BYELLOW: rgba(255, 255, 85, 255), // 14 bright yellow
  BWHITE: rgba(255, 255, 255, 255) // 15 bright white
};

export const THEMES = {
  EGA: {
    MODE4: {
      PALETTE1: {
        LOW: [cga.BLACK, cga.WHITE, cga.MAGENTA, cga.CYAN],
        HIGH: [cga.BLACK, cga.WHITE, cga.BMAGENTA, cga.BCYAN]
      },
      PALETTE2: {
        LOW: [cga.BLACK, cga.GREEN, cga.RED, cga.YELLOW],
        HIGH: [cga.BLACK, cga.BGREEN, cga.BRED, cga.BYELLOW]
      }
    }
  },
  CGA: [
    cga.BLACK,
    cga.BLUE,
    cga.GREEN,
    cga.CYAN,
    cga.RED,
    cga.MAGENTA,
    cga.YELLOW,
    cga.WHITE,
    cga.BBLACK,
    cga.BBLUE,
    cga.BGREEN,
    cga.BCYAN,
    cga.BRED,
    cga.BMAGENTA,
    cga.BYELLOW,
    cga.BWHITE
  ],
  MAC2: [
    rgba(255, 255, 255, 255), // white
    rgba(255, 255, 0, 255), // yellow
    rgba(255, 102, 0, 255), // orange
    rgba(221, 0, 0, 255), // red
    rgba(255, 0, 153, 255), // magenta
    rgba(51, 0, 153, 255), // purple
    rgba(0, 0, 204, 255), // blue
    rgba(0, 153, 255, 255), // cyan
    rgba(0, 170, 0, 255), // green
    rgba(0, 102, 0, 255), // dark green
    rgba(102, 51, 0, 255), // brown
    rgba(153, 102, 51, 255), // tan
    rgba(187, 187, 187, 255), // light grey
    rgba(136, 136, 136, 255), // medium grey
    rgba(68, 68, 68, 255), // dark grey
    rgba(0, 0, 0, 255) // black
  ],
  SEPIA: [
    rgba(8, 8, 0, 255),
    rgba(39, 34, 24, 255),
    rgba(70, 63, 48, 255),
    rgba(101, 93, 72, 255),
    rgba(132, 122, 96, 255),
    rgba(163, 152, 120, 255),
    rgba(194, 182, 145, 255),
    rgba(225, 211, 169, 255)
  ],
  VAPORWAVE: [
    // modified http://www.colourlovers.com/palette/3636765/seapunk_vaporwave
    rgba(255, 106, 213, 255),
    rgba(199, 116, 232, 255),
    rgba(173, 140, 255, 255),
    rgba(135, 149, 232, 255),
    rgba(148, 208, 255, 255)
  ]
};

const optionTypes = {
  palette: {
    type: COLOR_ARRAY,
    default: THEMES.CGA
  }
};

const defaults = { colors: optionTypes.palette.default };

// https://en.wikipedia.org/wiki/Color_difference
// Simple Euclidian distance
// const colorDistance = (a: ColorRGBA, b: ColorRGBA): number =>
//   Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

// TODO: Use LAB?
// Approximation given on Wiki page
const colorDistance = (a: ColorRGBA, b: ColorRGBA): number => {
  const r = (a[0] + b[0]) / 2;
  const dR = a[0] - b[0];
  const dG = a[1] - b[1];
  const dB = a[2] - b[2];

  const dRc = (2 + r / 256) * dR ** 2;
  const dGc = 4 * dG ** 2 + (2 + (255 - r) / 256);
  const dBc = dB ** 2;

  return Math.sqrt(dRc + dGc + dBc);
};

// Gets nearest color
const getColor = (
  color: ColorRGBA,
  options: { colors: Array<ColorRGBA> } = defaults
): ColorRGBA => {
  const { colors } = options;

  if (!colors) {
    return color;
  }

  let min = null;
  let minDistance = 0;

  colors.forEach(pc => {
    const distance = Math.abs(colorDistance(pc, color));

    if (min === null) {
      min = pc;
      minDistance = distance;
    } else if (distance < minDistance) {
      min = pc;
      minDistance = distance;
    }
  });

  return !min ? color : min;
};

export default {
  getColor,
  optionTypes,
  defaults
};
