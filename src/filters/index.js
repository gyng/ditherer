// @flow

import * as palettes from "palettes";
import { THEMES } from "palettes/user";

import binarize, { optionTypes as binarizeOptions } from "./binarize";
import grayscale, { optionTypes as grayscaleOptions } from "./grayscale";
import ordered, { optionTypes as orderedOptions } from "./ordered";
import random, { optionTypes as randomOptions } from "./random";
import halftone, { optionTypes as halftoneOptions } from "./halftone";
import quantize, { optionTypes as quantizeOptions } from "./quantize";
import {
  atkinson,
  floydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  jarvis,
  optionTypes as errorDiffusingOptions
} from "./errorDiffusing";

export { default as binarize } from "./binarize";
export { default as grayscale } from "./grayscale";
export { default as ordered } from "./ordered";
export { default as halftone } from "./halftone";
export { default as quantize } from "./quantize";
export {
  atkinson,
  floydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  jarvis
} from "./errorDiffusing";

export const filterList = [
  { name: "Grayscale", filter: grayscale, optionTypes: grayscaleOptions },
  { name: "Random", filter: random, optionTypes: randomOptions },
  { name: "Halftone", filter: halftone, optionTypes: halftoneOptions },
  { name: "Binarize", filter: binarize, optionTypes: binarizeOptions },
  {
    name: "Quantize (No dithering)",
    filter: quantize,
    optionTypes: quantizeOptions
  },
  {
    name: "Quantize (No dithering, EGA test)",
    filter: quantize,
    options: {
      palette: {
        ...palettes.user,
        options: { colors: THEMES.EGA.MODE4.PALETTE1.LOW }
      }
    },
    optionTypes: quantizeOptions
  },
  { name: "Ordered (Windows)", filter: ordered, optionTypes: orderedOptions },
  {
    name: "Floyd-Steinberg",
    filter: floydSteinberg,
    optionTypes: errorDiffusingOptions
  },
  {
    name: "Floyd-Steinberg (EGA test)",
    filter: floydSteinberg,
    options: {
      palette: {
        ...palettes.user,
        options: { colors: THEMES.EGA.MODE4.PALETTE1.HIGH }
      }
    },
    optionTypes: errorDiffusingOptions
  },
  {
    name: "Floyd-Steinberg (CGA test)",
    filter: floydSteinberg,
    options: {
      palette: {
        ...palettes.user,
        options: { colors: THEMES.CGA }
      }
    },
    optionTypes: errorDiffusingOptions
  },
  { name: "Jarvis", filter: jarvis, optionTypes: errorDiffusingOptions },
  {
    name: "Atkinson (Mac)",
    filter: atkinson,
    optionTypes: errorDiffusingOptions
  },
  { name: "Sierra (full)", filter: sierra, optionTypes: errorDiffusingOptions },
  {
    name: "Sierra (two-row)",
    filter: sierra2,
    optionTypes: errorDiffusingOptions
  },
  {
    name: "Sierra (lite)",
    filter: sierraLite,
    optionTypes: errorDiffusingOptions
  }
];
