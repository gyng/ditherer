import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderPosterizeGL } from "./posterizeGL";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 32], step: 1, default: 4, desc: "Number of distinct color levels per channel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  palette: optionTypes.palette.default
};

const posterize = (input: any, options: typeof defaults = defaults) => {
  const { levels, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderPosterizeGL(input, W, H, levels);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Posterize", "WebGL2", `levels=${levels}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Posterize",
  func: posterize,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
