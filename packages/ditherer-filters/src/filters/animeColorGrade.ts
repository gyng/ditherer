import { ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { animeLookId } from "./animeProductionContracts";
import { renderAnimeColorGradeGL } from "./animeColorGradeGL";
import { defineFilter } from "./types";

export const ANIME_LOOK = {
  BALANCED: "BALANCED",
  CLEAR_DAY: "CLEAR_DAY",
  GOLDEN_HOUR: "GOLDEN_HOUR",
  BLUE_HOUR: "BLUE_HOUR",
  NEON_NIGHT: "NEON_NIGHT",
} as const;

export const optionTypes = {
  look: {
    type: ENUM,
    options: [
      { name: "Balanced", value: ANIME_LOOK.BALANCED },
      { name: "Clear day", value: ANIME_LOOK.CLEAR_DAY },
      { name: "Golden hour", value: ANIME_LOOK.GOLDEN_HOUR },
      { name: "Blue hour", value: ANIME_LOOK.BLUE_HOUR },
      { name: "Neon night", value: ANIME_LOOK.NEON_NIGHT },
    ],
    default: ANIME_LOOK.CLEAR_DAY,
    desc: "Scene color script that sets distinct shadow, base, and highlight hues",
  },
  shadowCool: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.38,
    desc: "Strength of the look's authored shadow color",
  },
  highlightWarm: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.3,
    desc: "Strength of the look's authored highlight color",
  },
  blackPoint: {
    type: RANGE,
    range: [0, 128],
    step: 1,
    default: 0,
    desc: "Input level mapped to display black",
  },
  whitePoint: {
    type: RANGE,
    range: [128, 255],
    step: 1,
    default: 255,
    desc: "Input level mapped to display white",
  },
  contrast: {
    type: RANGE,
    range: [-0.5, 0.5],
    step: 0.05,
    default: 0.08,
    desc: "Luminance contrast before the scene color script",
  },
  midtoneLift: {
    type: RANGE,
    range: [-0.5, 0.5],
    step: 0.05,
    default: 0.03,
    desc: "Raise or lower middle values without moving black or white",
  },
  highlightRollOff: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.35,
    desc: "Compress bright values into a softer painted shoulder",
  },
  vibrance: {
    type: RANGE,
    range: [0, 1.5],
    step: 0.05,
    default: 0.38,
    desc: "Increase muted chroma more than already-saturated colors",
  },
  chromaDensity: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.28,
    desc: "Deepen saturated colors in darker value regions",
  },
  skinProtect: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.65,
    desc: "Keep likely skin hues closer to the balanced tonal result",
  },
  mix: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.9,
    desc: "Opacity of the complete scene grade over the source",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  look: optionTypes.look.default,
  shadowCool: optionTypes.shadowCool.default,
  highlightWarm: optionTypes.highlightWarm.default,
  blackPoint: optionTypes.blackPoint.default,
  whitePoint: optionTypes.whitePoint.default,
  contrast: optionTypes.contrast.default,
  midtoneLift: optionTypes.midtoneLift.default,
  highlightRollOff: optionTypes.highlightRollOff.default,
  vibrance: optionTypes.vibrance.default,
  chromaDensity: optionTypes.chromaDensity.default,
  skinProtect: optionTypes.skinProtect.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeColorGrade = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const resolved = { ...defaults, ...options };
  const W = input.width,
    H = input.height;
  const rendered = renderAnimeColorGradeGL(
    input,
    W,
    H,
    animeLookId(resolved.look),
    resolved.shadowCool,
    resolved.highlightWarm,
    resolved.blackPoint,
    resolved.whitePoint,
    resolved.contrast,
    resolved.midtoneLift,
    resolved.highlightRollOff,
    resolved.vibrance,
    resolved.chromaDensity,
    resolved.skinProtect,
    resolved.mix,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(resolved.palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, resolved.palette);
  logFilterBackend(
    "Anime Color Grade",
    "WebGL2",
    `${resolved.look}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Anime Color Grade",
  func: animeColorGrade,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Scene-scripted anime grading with authored value colors, soft highlights, dense chroma, and skin protection",
  requiresGL: true,
});
