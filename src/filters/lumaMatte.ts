import { RANGE, BOOL, ENUM } from "constants/controlTypes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { renderLumaMatteGL } from "./lumaMatteGL";

const BG_MODE = {
  TRANSPARENT: "TRANSPARENT",
  BLACK: "BLACK",
  WHITE: "WHITE"
};

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance threshold used to build the matte" },
  feather: { type: RANGE, range: [0, 80], step: 1, default: 16, desc: "Soft transition width around the threshold" },
  invert: { type: BOOL, default: false, desc: "Flip which side of the threshold is kept" },
  backgroundMode: {
    type: ENUM,
    options: [
      { name: "Transparent", value: BG_MODE.TRANSPARENT },
      { name: "Black", value: BG_MODE.BLACK },
      { name: "White", value: BG_MODE.WHITE }
    ],
    default: BG_MODE.BLACK,
    desc: "What to show behind pixels rejected by the matte"
  }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  feather: optionTypes.feather.default,
  invert: optionTypes.invert.default,
  backgroundMode: optionTypes.backgroundMode.default
};

const lumaMatte = (input: any, options: typeof defaults = defaults) => {
  const { threshold, feather, invert, backgroundMode } = options;
  const W = input.width;
  const H = input.height;

  const low = Math.max(0, threshold - feather);
  const high = Math.min(255, threshold + feather);
  const bgModeInt = backgroundMode === BG_MODE.TRANSPARENT ? 0 : backgroundMode === BG_MODE.BLACK ? 1 : 2;

  const rendered = renderLumaMatteGL(input, W, H, low, high, invert, bgModeInt as 0 | 1 | 2);
  if (!rendered) return input;
  logFilterBackend("Luma Matte", "WebGL2", `t=${threshold} feather=${feather} bg=${backgroundMode}`);
  return rendered;
};

export default defineFilter({
  name: "Luma Matte",
  func: lumaMatte,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
