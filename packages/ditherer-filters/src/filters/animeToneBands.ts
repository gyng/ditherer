import { BOOL, COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderAnimeToneBandsGL } from "./animeToneBandsGL";
import { defineFilter } from "./types";

export const optionTypes = {
  structureScale: {
    type: RANGE,
    range: [1, 12],
    step: 1,
    default: 5,
    desc: "Radius used to suppress photographic texture before forming value regions",
  },
  shadowThreshold: {
    type: RANGE,
    range: [0.05, 0.65],
    step: 0.01,
    default: 0.34,
    desc: "Structural luminance below which pixels receive the authored shadow color",
  },
  highlightThreshold: {
    type: RANGE,
    range: [0.4, 0.98],
    step: 0.01,
    default: 0.77,
    desc: "Structural luminance above which pixels receive the authored highlight color",
  },
  shadowSteps: {
    type: RANGE,
    range: [2, 8],
    step: 1,
    default: 3,
    desc: "Broad value steps retained in the darker half",
  },
  highlightSteps: {
    type: RANGE,
    range: [2, 8],
    step: 1,
    default: 4,
    desc: "Broad value steps retained in the brighter half",
  },
  edgeSoftness: {
    type: RANGE,
    range: [0, 0.35],
    step: 0.01,
    default: 0.06,
    desc: "Narrow transition zone around value-band boundaries",
  },
  bandBias: {
    type: RANGE,
    range: [-0.4, 0.4],
    step: 0.05,
    default: 0.03,
    desc: "Move structural detail toward shadow or highlight regions",
  },
  shadowTint: {
    type: COLOR,
    default: [82, 112, 168],
    desc: "Authored color assigned to shadow value regions",
  },
  highlightTint: {
    type: COLOR,
    default: [255, 225, 181],
    desc: "Authored color assigned to highlight value regions",
  },
  colorSeparation: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.22,
    desc: "Strength of distinct shadow and highlight colors",
  },
  preserveSkin: {
    type: BOOL,
    default: true,
    desc: "Reduce quantization and tinting on likely skin hues",
  },
  mix: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.66,
    desc: "Blend the structured cel-color result over the source",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  structureScale: optionTypes.structureScale.default,
  shadowThreshold: optionTypes.shadowThreshold.default,
  highlightThreshold: optionTypes.highlightThreshold.default,
  shadowSteps: optionTypes.shadowSteps.default,
  highlightSteps: optionTypes.highlightSteps.default,
  edgeSoftness: optionTypes.edgeSoftness.default,
  bandBias: optionTypes.bandBias.default,
  shadowTint: optionTypes.shadowTint.default,
  highlightTint: optionTypes.highlightTint.default,
  colorSeparation: optionTypes.colorSeparation.default,
  preserveSkin: optionTypes.preserveSkin.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeToneBands = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const resolved = { ...defaults, ...options };
  const W = input.width,
    H = input.height;
  const rendered = renderAnimeToneBandsGL(
    input,
    W,
    H,
    resolved.structureScale,
    resolved.shadowThreshold,
    resolved.highlightThreshold,
    resolved.shadowSteps,
    resolved.highlightSteps,
    resolved.edgeSoftness,
    resolved.bandBias,
    resolved.shadowTint,
    resolved.highlightTint,
    resolved.colorSeparation,
    resolved.preserveSkin,
    resolved.mix,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(resolved.palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, resolved.palette);
  logFilterBackend(
    "Anime Tone Bands",
    "WebGL2",
    `structure=${resolved.structureScale}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Anime Tone Bands",
  func: animeToneBands,
  optionTypes,
  options: defaults,
  defaults,
  description: "Structure-aware cel values with authored shadow, base, and highlight colors",
  requiresGL: true,
});
