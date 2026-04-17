import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderHalationGL } from "./halationGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 60], step: 1, default: 18, desc: "Glow spread — how far the halation bleed reaches around bright areas" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 100, desc: "Brightness cutoff for what contributes to the halation glow" },
  strength: { type: RANGE, range: [0, 2], step: 0.05, default: 0.9, desc: "Intensity of the screen-blended glow" },
  tint: { type: COLOR, default: [255, 60, 40], desc: "Halation colour — CineStill 800T's pink-red default emulates the missing anti-halation layer" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  tint: optionTypes.tint.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const halation = (input: any, options: typeof defaults = defaults) => {
  const { radius, threshold, strength, tint, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderHalationGL(input, W, H, radius, threshold, strength, tint);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Halation", "WebGL2", `r=${radius} thr=${threshold}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Halation",
  func: halation,
  optionTypes,
  options: defaults,
  defaults,
  description: "Pink-red glow around highlights — mimics CineStill 800T and other films where light bleeds through a missing anti-halation layer",
  requiresGL: true });
