// @flow

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
  { name: "Grayscale", filter: grayscale, options: grayscaleOptions },
  { name: "Random", filter: random, options: randomOptions },
  { name: "Halftone", filter: halftone, options: halftoneOptions },
  { name: "Binarize", filter: binarize, options: binarizeOptions },
  { name: "Quantize", filter: quantize, options: quantizeOptions },
  { name: "Ordered (Windows)", filter: ordered, options: orderedOptions },
  {
    name: "Floyd-Steinberg",
    filter: floydSteinberg,
    options: errorDiffusingOptions
  },
  { name: "Jarvis", filter: jarvis, options: errorDiffusingOptions },
  { name: "Atkinson (Mac)", filter: atkinson, options: errorDiffusingOptions },
  { name: "Sierra (full)", filter: sierra, options: errorDiffusingOptions },
  {
    name: "Sierra (two-row)",
    filter: sierra2,
    options: errorDiffusingOptions
  },
  { name: "Sierra (lite)", filter: sierraLite, options: errorDiffusingOptions }
];
