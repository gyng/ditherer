import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderColorHalftoneSeparateGL } from "./colorHalftoneSeparateGL";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Halftone dot diameter" },
  offsetR: { type: RANGE, range: [0, 10], step: 1, default: 2, desc: "Red screen registration offset" },
  offsetG: { type: RANGE, range: [0, 10], step: 1, default: 0, desc: "Green screen registration offset" },
  offsetB: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Blue screen registration offset" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  offsetR: optionTypes.offsetR.default,
  offsetG: optionTypes.offsetG.default,
  offsetB: optionTypes.offsetB.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorHalftoneSeparate = (input: any, options: typeof defaults = defaults) => {
  const { dotSize, offsetR, offsetG, offsetB, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderColorHalftoneSeparateGL(input, W, H, dotSize, offsetR, offsetG, offsetB);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Color Halftone Separate", "WebGL2", `dotSize=${dotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Color Halftone Separate", func: colorHalftoneSeparate, optionTypes, options: defaults, defaults, requiresGL: true });
