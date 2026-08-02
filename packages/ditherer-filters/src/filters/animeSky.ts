import { COLOR, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderAnimeSkyGL } from "./animeSkyGL";
import { defineFilter } from "./types";

const SKY_MODE = { GRADIENT: "GRADIENT", CLOUDS: "CLOUDS" } as const;

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Painted gradient", value: SKY_MODE.GRADIENT },
      { name: "Painted gradient + clouds", value: SKY_MODE.CLOUDS },
    ],
    default: SKY_MODE.CLOUDS,
    desc: "Environment treatment applied to likely connected sky regions",
  },
  skyStart: {
    type: RANGE,
    range: [0.15, 0.85],
    step: 0.01,
    default: 0.4,
    desc: "Approximate horizon as a fraction of image height",
  },
  gradientTop: { type: COLOR, default: [72, 139, 238], desc: "Zenith color of the painted sky" },
  gradientBottom: {
    type: COLOR,
    default: [224, 239, 252],
    desc: "Near-horizon color of the painted sky",
  },
  cloudAmount: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.48,
    desc: "Coverage and brightness of coherent painted cloud masses",
  },
  cloudSoftness: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.62,
    desc: "Feathering of cloud bodies into the sky",
  },
  cloudScale: {
    type: RANGE,
    range: [1, 12],
    step: 0.5,
    default: 4.5,
    desc: "Scale of the multi-octave cloud masses",
  },
  horizonGlow: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.32,
    desc: "Warm luminous haze concentrated near the horizon",
  },
  maskTolerance: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.46,
    desc: "Admit neutral and less-blue pixels into the sky-confidence mask",
  },
  blend: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.88,
    desc: "Strength of the painted environment over detected sky",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  mode: optionTypes.mode.default,
  skyStart: optionTypes.skyStart.default,
  gradientTop: optionTypes.gradientTop.default,
  gradientBottom: optionTypes.gradientBottom.default,
  cloudAmount: optionTypes.cloudAmount.default,
  cloudSoftness: optionTypes.cloudSoftness.default,
  cloudScale: optionTypes.cloudScale.default,
  horizonGlow: optionTypes.horizonGlow.default,
  maskTolerance: optionTypes.maskTolerance.default,
  blend: optionTypes.blend.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeSky = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const resolved = { ...defaults, ...options };
  const W = input.width,
    H = input.height;
  const rendered = renderAnimeSkyGL(
    input,
    W,
    H,
    resolved.mode === SKY_MODE.CLOUDS,
    resolved.skyStart,
    resolved.gradientTop,
    resolved.gradientBottom,
    resolved.cloudAmount,
    resolved.cloudSoftness,
    resolved.cloudScale,
    resolved.horizonGlow,
    resolved.maskTolerance,
    resolved.blend,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(resolved.palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, resolved.palette);
  logFilterBackend("Anime Sky", "WebGL2", `${resolved.mode}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Anime Sky",
  func: animeSky,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Conservative sky repaint with coherent clouds, horizon light, and an authored color gradient",
  requiresGL: true,
});
