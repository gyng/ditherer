import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderAnimeSkyGL } from "./animeSkyGL";

const SKY_MODE = {
  GRADIENT: "GRADIENT",
  CLOUDS: "CLOUDS" };

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Gradient", value: SKY_MODE.GRADIENT },
      { name: "Gradient + Clouds", value: SKY_MODE.CLOUDS },
    ],
    default: SKY_MODE.CLOUDS,
    desc: "How the sky area is restyled" },
  skyStart: { type: RANGE, range: [0.15, 0.85], step: 0.01, default: 0.48, desc: "Bottom edge of the sky region as a fraction of image height" },
  gradientTop: { type: COLOR, default: [87, 150, 255], desc: "Top-of-sky color" },
  gradientBottom: { type: COLOR, default: [223, 240, 255], desc: "Near-horizon sky color" },
  cloudAmount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "Intensity of the painted cloud layer" },
  cloudSoftness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "Softness and spread of cloud shapes" },
  blend: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "How strongly the synthetic sky replaces the detected sky" },
  palette: { type: PALETTE, default: nearest } };

export const defaults = {
  mode: optionTypes.mode.default,
  skyStart: optionTypes.skyStart.default,
  gradientTop: optionTypes.gradientTop.default,
  gradientBottom: optionTypes.gradientBottom.default,
  cloudAmount: optionTypes.cloudAmount.default,
  cloudSoftness: optionTypes.cloudSoftness.default,
  blend: optionTypes.blend.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } } };

const animeSky = (input: any, options: typeof defaults = defaults) => {
  const { mode, skyStart, gradientTop, gradientBottom, cloudAmount, cloudSoftness, blend, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderAnimeSkyGL(input, W, H,
      mode === SKY_MODE.CLOUDS, skyStart,
      [gradientTop[0], gradientTop[1], gradientTop[2]],
      [gradientBottom[0], gradientBottom[1], gradientBottom[2]],
      cloudAmount, cloudSoftness, blend,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Anime Sky", "WebGL2", `mode=${mode}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Anime Sky",
  func: animeSky,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
