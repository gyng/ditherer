import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderChromaticPosterizeGL } from "./chromaticPosterizeGL";

export const optionTypes = {
  levelsR: { type: RANGE, range: [2, 32], step: 1, default: 4, desc: "Quantization levels for red channel" },
  levelsG: { type: RANGE, range: [2, 32], step: 1, default: 8, desc: "Quantization levels for green channel" },
  levelsB: { type: RANGE, range: [2, 32], step: 1, default: 3, desc: "Quantization levels for blue channel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levelsR: optionTypes.levelsR.default,
  levelsG: optionTypes.levelsG.default,
  levelsB: optionTypes.levelsB.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const chromaticPosterize = (input: any, options: typeof defaults = defaults) => {
  const { levelsR, levelsG, levelsB, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderChromaticPosterizeGL(input, W, H, levelsR, levelsG, levelsB);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Chromatic Posterize", "WebGL2", `R=${levelsR} G=${levelsG} B=${levelsB}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Chromatic Posterize",
  func: chromaticPosterize,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
