import { BOOL, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderAnimeToneBandsGL } from "./animeToneBandsGL";

export const optionTypes = {
  shadowSteps: { type: RANGE, range: [2, 8], step: 1, default: 3, desc: "How many broad bands to keep in darker regions" },
  highlightSteps: { type: RANGE, range: [2, 8], step: 1, default: 4, desc: "How many broad bands to keep in brighter regions" },
  edgeSoftness: { type: RANGE, range: [0, 0.35], step: 0.01, default: 0.08, desc: "Soft blend zone around tone-band boundaries" },
  bandBias: { type: RANGE, range: [-0.4, 0.4], step: 0.05, default: 0.05, desc: "Bias more band detail toward shadows or highlights" },
  preserveSkin: { type: BOOL, default: true, desc: "Reduce banding on likely skin tones" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "Blend the tone-banded result over the source image" },
  palette: { type: PALETTE, default: nearest } };

export const defaults = {
  shadowSteps: optionTypes.shadowSteps.default,
  highlightSteps: optionTypes.highlightSteps.default,
  edgeSoftness: optionTypes.edgeSoftness.default,
  bandBias: optionTypes.bandBias.default,
  preserveSkin: optionTypes.preserveSkin.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } } };

const animeToneBands = (input: any, options: typeof defaults = defaults) => {
  const { shadowSteps, highlightSteps, edgeSoftness, bandBias, preserveSkin, mix, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderAnimeToneBandsGL(input, W, H,
      shadowSteps, highlightSteps, edgeSoftness, bandBias, preserveSkin, mix,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Anime Tone Bands", "WebGL2", `sh=${shadowSteps} hl=${highlightSteps}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Anime Tone Bands",
  func: animeToneBands,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
