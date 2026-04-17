import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderSumiEGL } from "./sumiEGL";

export const optionTypes = {
  brushSoftness: { type: RANGE, range: [0.5, 12], step: 0.5, default: 3, desc: "Gaussian sigma for the wash base — higher = looser, more continuous washes" },
  washLevels: { type: RANGE, range: [2, 6], step: 1, default: 4, desc: "Number of discrete ink-dilution bands (deep black, dark, mid, light)" },
  washStrength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "Overall ink density — 0 leaves the paper, 1 saturates darks fully" },
  washSoftness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Smoothness of the band boundaries — 0 hard poster, 1 continuous" },
  edgeThreshold: { type: RANGE, range: [0, 0.8], step: 0.02, default: 0.18, desc: "Sobel gradient cutoff — raise to show fewer, more confident strokes" },
  edgeStrength: { type: RANGE, range: [0, 1.5], step: 0.05, default: 0.5, desc: "Ink intensity of the brush strokes at strong edges" },
  inkColor: { type: COLOR, default: [28, 24, 22], desc: "Ink colour for the darkest washes and brush strokes" },
  paperColor: { type: COLOR, default: [240, 232, 210], desc: "Unpainted paper background colour" },
  grain: { type: RANGE, range: [0, 0.6], step: 0.02, default: 0.12, desc: "Paper texture — flecks of paper showing through the ink" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  brushSoftness: optionTypes.brushSoftness.default,
  washLevels: optionTypes.washLevels.default,
  washStrength: optionTypes.washStrength.default,
  washSoftness: optionTypes.washSoftness.default,
  edgeThreshold: optionTypes.edgeThreshold.default,
  edgeStrength: optionTypes.edgeStrength.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  grain: optionTypes.grain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const hash2D = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const sumiE = (input: any, options: typeof defaults = defaults) => {
  const { brushSoftness, washLevels, washStrength, washSoftness, edgeThreshold, edgeStrength, inkColor, paperColor, grain, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderSumiEGL(input, W, H, brushSoftness, washLevels, washStrength, washSoftness,
      edgeThreshold, edgeStrength, inkColor, paperColor, grain,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Sumi-e", "WebGL2", `levels=${washLevels} brush=${brushSoftness}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Sumi-e",
  func: sumiE,
  optionTypes,
  options: defaults,
  defaults,
  description: "Japanese ink-wash painting — quantized tonal washes plus strong Sobel brush strokes on paper",
  requiresGL: true });
