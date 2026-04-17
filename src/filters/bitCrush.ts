import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { paletteIsIdentity, applyPalettePassToCanvas } from "palettes/backend";
import { defineFilter } from "filters/types";
import { renderBitCrushGL } from "./bitCrushGL";

export const optionTypes = {
  bits: { type: RANGE, range: [1, 8], step: 1, default: 3, desc: "Bits per channel — fewer bits = harsher posterization" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bits: optionTypes.bits.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const bitCrush = (input: any, options: typeof defaults = defaults) => {
  const { bits, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderBitCrushGL(input, W, H, bits);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Bit crush", "WebGL2", `bits=${bits}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Bit crush",
  func: bitCrush,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
