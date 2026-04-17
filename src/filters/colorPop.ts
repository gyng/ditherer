import { RANGE } from "constants/controlTypes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { renderColorPopGL } from "./colorPopGL";

export const optionTypes = {
  targetHue: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Hue family to preserve in degrees" },
  hueWidth: { type: RANGE, range: [5, 180], step: 1, default: 25, desc: "Half-width of the protected hue band" },
  desaturateOthers: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "How much to mute colors outside the selected hue band" },
  softness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Soft falloff around the hue band edge" }
};

export const defaults = {
  targetHue: optionTypes.targetHue.default,
  hueWidth: optionTypes.hueWidth.default,
  desaturateOthers: optionTypes.desaturateOthers.default,
  softness: optionTypes.softness.default
};

const colorPop = (input: any, options: typeof defaults = defaults) => {
  const { targetHue, hueWidth, desaturateOthers, softness } = options;
  const W = input.width, H = input.height;

  const rendered = renderColorPopGL(input, W, H, targetHue, hueWidth, desaturateOthers, softness);
  if (!rendered) return input;
  logFilterBackend("Color Pop", "WebGL2", `hue=${targetHue} w=${hueWidth}`);
  return rendered;
};

export default defineFilter({
  name: "Color Pop",
  func: colorPop,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
