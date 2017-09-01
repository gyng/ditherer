// @flow

import binarize, { optionTypes as binarizeOptions } from "./binarize";
import grayscale, { optionTypes as grayscaleOptions } from "./grayscale";
import floydSteinberg, { optionTypes as fsOptions } from "./floydSteinberg";
import ordered, { optionTypes as orderedOptions } from "./ordered";

export { default as binarize } from "./binarize";
export { default as grayscale } from "./grayscale";
export { default as floydSteinberg } from "./floydSteinberg";
export { default as ordered } from "./ordered";

export const filterList = [
  { name: "Binarize", filter: binarize, options: binarizeOptions },
  { name: "Grayscale", filter: grayscale, options: grayscaleOptions },
  { name: "Floyd-Steinberg", filter: floydSteinberg, options: fsOptions },
  { name: "Ordered", filter: ordered, options: orderedOptions }
];
