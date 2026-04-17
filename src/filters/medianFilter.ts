import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderMedianFilterGL } from "./medianFilterGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Neighborhood radius for median calculation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const medianFilter = (input: any, options: typeof defaults = defaults) => {
  const { radius, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderMedianFilterGL(input, W, H, radius);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Median Filter", "WebGL2", `r=${radius}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Median Filter",
  func: medianFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
