// @flow

import {
  RGB_NEAREST,
  RGB_APPROX,
  LAB_NEAREST,
  HSV_NEAREST,
  WASM_LAB_NEAREST
} from "constants/color";

export const BOOL = "BOOL";
export const ENUM = "ENUM";
export const RANGE = "RANGE";
export const STRING = "STRING";
export const TEXT = "TEXT";
export const PALETTE = "PALETTE";
export const COLOR_ARRAY = "COLOR_ARRAY";

export const COLOR_DISTANCE_ALGORITHM = {
  type: ENUM,
  options: [
    { name: "RGB", value: RGB_NEAREST },
    { name: "RGB (perceptual approx.)", value: RGB_APPROX },
    { name: "HSV", value: HSV_NEAREST },
    { name: "Lab", value: LAB_NEAREST },
    { name: "Lab (wasm)", value: WASM_LAB_NEAREST }
  ],
  default: RGB_APPROX
};
