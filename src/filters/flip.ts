import { ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderFlipGL } from "./flipGL";

const MODE = { HORIZONTAL: "HORIZONTAL", VERTICAL: "VERTICAL", BOTH: "BOTH" };

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Horizontal", value: MODE.HORIZONTAL },
    { name: "Vertical", value: MODE.VERTICAL },
    { name: "Both", value: MODE.BOTH }
  ], default: MODE.HORIZONTAL, desc: "Flip axis — horizontal, vertical, or both" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const flipFilter = (input: any, options: typeof defaults = defaults) => {
  const { mode, palette } = options;
  const W = input.width, H = input.height;
  const flipX = mode === MODE.HORIZONTAL || mode === MODE.BOTH;
  const flipY = mode === MODE.VERTICAL || mode === MODE.BOTH;
  const rendered = renderFlipGL(input, W, H, flipX, flipY);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Flip", "WebGL2", `mode=${mode}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Flip",
  func: flipFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
