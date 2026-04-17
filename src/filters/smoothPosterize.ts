import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderSmoothPosterizeGL } from "./smoothPosterizeGL";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5, desc: "Number of color levels" },
  smoothness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Transition smoothness between levels" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  smoothness: optionTypes.smoothness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const smoothPosterize = (input: any, options: typeof defaults = defaults) => {
  const { levels, smoothness, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderSmoothPosterizeGL(input, W, H, levels, smoothness);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Smooth Posterize", "WebGL2", `levels=${levels} smooth=${smoothness}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Smooth Posterize",
  func: smoothPosterize,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
