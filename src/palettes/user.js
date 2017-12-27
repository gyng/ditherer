// @flow

import { COLOR_ARRAY, COLOR_DISTANCE_ALGORITHM } from "constants/controlTypes";

import { rgba, colorDistance } from "utils";

import type { ColorRGBA, ColorDistanceAlgorithm } from "types";

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
  CMYK: [
    rgba(0, 255, 255, 255), // cyan
    rgba(255, 0, 255, 255), // magenta
    rgba(255, 255, 0, 255), // yellow
    rgba(0, 0, 0, 255), // black
    rgba(255, 255, 255, 255)
  ],
  EGA_MODE4_PALETTE1_LOW: [cga.BLACK, cga.WHITE, cga.MAGENTA, cga.CYAN],
  EGA_MODE4_PALETTE1_HIGH: [cga.BLACK, cga.WHITE, cga.BMAGENTA, cga.BCYAN],
  EGA_MODE4_PALETTE2_LOW: [cga.BLACK, cga.GREEN, cga.RED, cga.YELLOW],
  EGA_MODE4_PALETTE2_HIGH: [cga.BLACK, cga.BGREEN, cga.BRED, cga.BYELLOW],
  EGA_MODE5_PALETTE3_LOW: [cga.BLACK, cga.CYAN, cga.RED, cga.BBLACK],
  EGA_MODE5_PALETTE3_HIGH: [cga.BLACK, cga.BCYAN, cga.BRED, cga.BWHITE],
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
  // https://upload.wikimedia.org/wikipedia/commons/1/14/CGA-NTSC-colors.png
  CGA_NTSC: [
    rgba(0, 0, 0, 255), // black
    rgba(0, 14, 163, 255), // blue
    rgba(0, 119, 23, 255), // green
    rgba(0, 156, 118, 255), // cyan
    rgba(111, 7, 31, 255), // red
    rgba(130, 34, 168, 255), // magenta
    rgba(117, 143, 26, 255), // yellow
    rgba(162, 162, 162, 255), // white
    rgba(73, 73, 73, 255), // bblack
    rgba(109, 92, 253, 255), // bblue
    rgba(94, 210, 75, 255), // bgreen
    rgba(105, 250, 209, 255), // bcyan
    rgba(204, 80, 116, 255), // bred
    rgba(224, 117, 254, 255), // bmagenta
    rgba(210, 237, 79, 255), // byellow
    rgba(255, 255, 255, 255) // bwhite
  ],
  // https://en.wikipedia.org/wiki/List_of_software_palettes#Microsoft_Windows_default_20-color_palette
  CGA_MICROSOFT_256: [
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
    cga.BWHITE,
    rgba(188, 219, 192, 255),
    rgba(157, 201, 238, 255),
    rgba(255, 251, 240, 255),
    rgba(158, 159, 162, 255)
  ],
  // https://en.wikipedia.org/wiki/File:Commodore64_palette.png
  C64: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(166, 77, 69, 255),
    rgba(88, 192, 199, 255),
    rgba(164, 88, 161, 255),
    rgba(82, 171, 100, 255),
    rgba(77, 71, 152, 255),
    rgba(203, 212, 141, 255),
    rgba(168, 104, 64, 255),
    rgba(113, 84, 28, 255),
    rgba(210, 125, 119, 255),
    rgba(99, 99, 99, 255),
    rgba(138, 138, 138, 255),
    rgba(144, 226, 157, 255),
    rgba(134, 126, 202, 255),
    rgba(174, 173, 174, 255)
  ],
  C64_NTSC: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(255, 52, 24, 255),
    rgba(0, 222, 253, 255),
    rgba(170, 78, 199, 255),
    rgba(95, 185, 89, 255),
    rgba(0, 77, 204, 255),
    rgba(255, 236, 84, 255),
    rgba(255, 90, 30, 255),
    rgba(201, 65, 22, 255),
    rgba(255, 113, 77, 255),
    rgba(96, 96, 96, 255),
    rgba(135, 152, 109, 255),
    rgba(170, 255, 157, 255),
    rgba(35, 136, 250, 255),
    rgba(195, 184, 213, 255)
  ],
  // https://en.wikipedia.org/wiki/File:BbcMicro_palette_color_test_chart.png
  TELETEXT_BBC_MICRO: [
    rgba(0, 0, 0, 255),
    rgba(255, 15, 22, 255),
    rgba(0, 254, 62, 255),
    rgba(0, 30, 250, 255),
    rgba(0, 255, 254, 255),
    rgba(255, 27, 249, 255),
    rgba(255, 254, 64, 255),
    rgba(255, 255, 255, 255)
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
  // https://en.wikipedia.org/wiki/File:AppleII_palette.png
  APPLE2: [
    rgba(0, 0, 0, 255),
    rgba(137, 61, 81, 255),
    rgba(78, 74, 134, 255),
    rgba(239, 96, 235, 255),
    rgba(0, 104, 84, 255),
    rgba(145, 145, 145, 255),
    rgba(0, 167, 237, 255),
    rgba(199, 194, 246, 255),
    rgba(82, 92, 31, 255),
    rgba(244, 125, 51, 255),
    rgba(145, 145, 145, 255),
    rgba(251, 184, 200, 255),
    rgba(0, 199, 63, 255),
    rgba(203, 209, 157, 255),
    rgba(144, 219, 202, 255),
    rgba(255, 255, 255, 255)
  ],
  // https://en.wikipedia.org/wiki/File:MSX_palette.png
  MSX: [
    rgba(0, 0, 0, 0),
    rgba(0, 0, 0, 255),
    rgba(35, 182, 83, 255),
    rgba(103, 206, 129, 255),
    rgba(79, 88, 218, 255),
    rgba(121, 119, 236, 255),
    rgba(191, 94, 83, 255),
    rgba(68, 218, 237, 255),
    rgba(227, 100, 91, 255),
    rgba(255, 135, 125, 255),
    rgba(206, 193, 102, 255),
    rgba(224, 207, 138, 255),
    rgba(41, 160, 74, 255),
    rgba(186, 102, 177, 255),
    rgba(203, 203, 203, 255),
    rgba(255, 255, 255, 255)
  ],
  MSX2_MODE6: [
    rgba(0, 0, 0, 255),
    rgba(255, 38, 23, 255),
    rgba(110, 108, 75, 255),
    rgba(255, 216, 149, 255)
  ],
  EARTHBOUND_1: [
    rgba(6, 6, 6, 255),
    rgba(239, 239, 239, 255),
    rgba(207, 207, 207, 255),
    rgba(142, 158, 129, 255),
    rgba(0, 174, 129, 255),
    rgba(0, 142, 112, 255),
    rgba(93, 127, 105, 255),
    rgba(193, 174, 130, 255),
    rgba(195, 158, 108, 255),
    rgba(154, 119, 91, 255),
    rgba(252, 16, 95, 255),
    rgba(150, 9, 51, 255),
    rgba(228, 206, 62, 255),
    rgba(232, 150, 48, 255),
    rgba(71, 83, 195, 255),
    rgba(53, 37, 37, 255)
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
  GAMEBOY: [
    rgba(155, 188, 15, 255),
    rgba(139, 172, 15, 255),
    rgba(48, 98, 48, 255),
    rgba(15, 56, 15, 255)
  ],
  // https://color.adobe.com/sandy-stone-beach-ocean-diver-color-theme-15325/
  SANDY_STONE_BEACH: [
    rgba(232, 225, 177, 255),
    rgba(166, 161, 127, 255),
    rgba(240, 235, 202, 255),
    rgba(0, 100, 126, 255),
    rgba(0, 51, 51, 255)
  ],
  VAPORWAVE: [
    // modified http://www.colourlovers.com/palette/3636765/seapunk_vaporwave
    rgba(255, 106, 213, 255),
    rgba(199, 116, 232, 255),
    rgba(173, 140, 255, 255),
    rgba(135, 149, 232, 255),
    rgba(148, 208, 255, 255),
    rgba(0, 0, 0, 255)
  ],
  WIREDSOUND: [
    // https://fauux.neocities.org
    rgba(210, 115, 138, 255),
    rgba(0, 0, 0, 255),
    rgba(193, 180, 146, 255)
  ],
  EMPTY: []
};

const optionTypes = {
  palette: {
    type: COLOR_ARRAY,
    default: THEMES.CGA
  },
  colorDistanceAlgorithm: COLOR_DISTANCE_ALGORITHM
};

const defaults = {
  colors: optionTypes.palette.default,
  colorDistanceAlgorithm: optionTypes.colorDistanceAlgorithm.default
};

const getColor = (
  color: ColorRGBA,
  options: {
    colors: Array<ColorRGBA>,
    colorDistanceAlgorithm: ColorDistanceAlgorithm
  } = defaults
): ColorRGBA => {
  const { colors } = options;
  const colorDistanceAlgorithm =
    options.colorDistanceAlgorithm || defaults.colorDistanceAlgorithm;

  if (!colors) {
    return color;
  }

  let min = null;
  let minDistance = 0;

  colors.forEach(pc => {
    const distance = colorDistance(pc, color, colorDistanceAlgorithm);

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

const user = {
  name: "User/Adaptive",
  getColor,
  options: defaults,
  optionTypes,
  defaults
};

export default user;

export const createPalette = (colors: Array<ColorRGBA>) => ({
  ...user,
  options: { ...user.options, colors, defaults: colors }
});
