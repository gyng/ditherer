import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { clamp, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderAnimeSkyGL } from "./animeSkyGL";

const SKY_MODE = {
  GRADIENT: "GRADIENT",
  CLOUDS: "CLOUDS" };

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp(0, 1, (value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const pseudoCloud = (xNorm: number, yNorm: number, cloudSoftness: number) => {
  const bandA = Math.sin(xNorm * 8.4 + yNorm * 6.2);
  const bandB = Math.sin(xNorm * 17.1 - yNorm * 11.6);
  const bandC = Math.sin((xNorm + yNorm * 0.75) * 29.3);
  const value = (bandA * 0.45 + bandB * 0.35 + bandC * 0.2 + 1) * 0.5;
  return smoothstep(0.55 - cloudSoftness * 0.25, 0.82 + cloudSoftness * 0.15, value);
};

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
