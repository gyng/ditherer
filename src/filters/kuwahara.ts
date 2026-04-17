import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderKuwaharaGL } from "./kuwaharaGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 16], step: 1, default: 3, desc: "Filter kernel radius — larger = more painterly" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const kuwahara = (input: any, options: typeof defaults = defaults) => {
  const { radius, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderKuwaharaGL(input, W, H, radius);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Kuwahara", "WebGL2", `radius=${radius}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Kuwahara",
  func: kuwahara,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
