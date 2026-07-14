import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderSolarizeGL } from "./solarizeGL";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 96, desc: "Brightness level above which pixels invert" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  // Solarize with threshold 96 can only emit channel values <= 96. The
  // nearest palette's own 2-level default therefore rounds every channel to
  // zero and makes the filter's default output an opaque black frame.
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const solarize = (input: any, options: typeof defaults = defaults) => {
  const { threshold, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderSolarizeGL(input, W, H, threshold);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Solarize", "WebGL2", `threshold=${threshold}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Solarize",
  func: solarize,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
