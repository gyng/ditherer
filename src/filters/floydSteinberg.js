// @flow

import { RANGE } from "constants/controlTypes";

import { makeErrorDiffusingFilter } from "./errorDiffusingFilterFactory";

export const optionTypes = {
  levels: { type: RANGE, range: [0, 255], default: 2 }
};

const defaultOptions = {
  levels: optionTypes.levels.default
};

// https://en.wikipedia.org/wiki/Floyd%E2%80%93Steinberg_dithering
// [_,    *,    7/16]
// [3/16, 5/16, 1/16]
const errorMatrix = {
  offset: [-1, 0], // x, y
  kernel: [[null, null, 7 / 16], [3 / 16, 5 / 16, 1 / 16]]
};

const floydSteinberg = makeErrorDiffusingFilter(errorMatrix, defaultOptions);
export default floydSteinberg;
