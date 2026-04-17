import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderGrainMergeGL } from "./grainMergeGL";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 2], step: 0.1, default: 0.5, desc: "Grain merge intensity" },
  radius: { type: RANGE, range: [1, 10], step: 1, default: 3, desc: "Blur radius for grain extraction" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const grainMerge = (input: any, options: typeof defaults = defaults) => {
  const { strength, radius, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderGrainMergeGL(input, W, H, radius, strength);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Grain Merge", "WebGL2", `r=${radius} strength=${strength}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Grain Merge",
  func: grainMerge,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
