import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderSepiaGL } from "./sepiaGL";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Sepia tone intensity" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const sepiaFilter = (input: any, options: typeof defaults = defaults) => {
  const { intensity, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderSepiaGL(input, W, H, intensity);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Sepia", "WebGL2", `intensity=${intensity}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Sepia",
  func: sepiaFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
