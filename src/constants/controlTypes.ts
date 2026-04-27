import {
  RGB_NEAREST,
  RGB_APPROX,
  LAB_NEAREST,
  HSV_NEAREST,
} from "constants/color";

import { SCALING_ALGORITHM } from "constants/optionTypes";

export const ACTION = "ACTION";
export const BOOL = "BOOL";
export const ENUM = "ENUM";
export const RANGE = "RANGE";
export const STRING = "STRING";
export const TEXT = "TEXT";
export const PALETTE = "PALETTE";
export const COLOR = "COLOR";
export const COLOR_ARRAY = "COLOR_ARRAY";
export const CURVE = "CURVE";
export const THRESHOLD_MAP_PREVIEW = "THRESHOLD_MAP_PREVIEW";

export const COLOR_DISTANCE_ALGORITHM = {
  type: ENUM,
  options: [
    { name: "RGB", value: RGB_NEAREST },
    { name: "RGB (perceptual approx.)", value: RGB_APPROX },
    { name: "HSV", value: HSV_NEAREST },
    { name: "Lab", value: LAB_NEAREST },
  ],
  default: RGB_APPROX
};

export const SCALING_ALGORITHM_OPTIONS = {
  type: ENUM,
  options: [
    { name: "Auto", value: SCALING_ALGORITHM.AUTO },
    { name: "Pixelated", value: SCALING_ALGORITHM.PIXELATED }
  ],
  default: SCALING_ALGORITHM.AUTO
};
