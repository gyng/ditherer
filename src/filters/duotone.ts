import { COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderDuotoneGL } from "./duotoneGL";

// Parse color that may be hex string (legacy URLs) or [r,g,b] array
const parseColor = (c: unknown): [number, number, number] => {
  if (Array.isArray(c)) return [c[0], c[1], c[2]];
  if (typeof c === "string") {
    const h = c.trim().replace("#", "");
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  return [0, 0, 0];
};

export const optionTypes = {
  shadowColor: { type: COLOR, default: [13, 2, 33], desc: "Color mapped to dark tones" },
  highlightColor: { type: COLOR, default: [255, 107, 107], desc: "Color mapped to bright tones" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  shadowColor: optionTypes.shadowColor.default,
  highlightColor: optionTypes.highlightColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const duotone = (input: any, options: typeof defaults = defaults) => {
  const { shadowColor, highlightColor, palette } = options;
  const W = input.width, H = input.height;
  const shadow = parseColor(shadowColor);
  const highlight = parseColor(highlightColor);

  const rendered = renderDuotoneGL(input, W, H, shadow, highlight);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Duotone", "WebGL2", identity ? "" : "+palettePass");
  return out ?? input;
};

export default defineFilter({
  name: "Duotone",
  func: duotone,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
