import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderPopArtGL } from "./popArtGL";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Ben-Day dot size" },
  levels: { type: RANGE, range: [2, 8], step: 1, default: 4, desc: "Color posterization levels" },
  saturationBoost: { type: RANGE, range: [1, 3], step: 0.1, default: 2, desc: "Vivid color saturation multiplier" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  levels: optionTypes.levels.default,
  saturationBoost: optionTypes.saturationBoost.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const popArt = (input: any, options: typeof defaults = defaults) => {
  const { dotSize, levels, saturationBoost, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderPopArtGL(input, W, H, dotSize, levels, saturationBoost);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Pop Art", "WebGL2", `dotSize=${dotSize} levels=${levels}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Pop Art", func: popArt, optionTypes, options: defaults, defaults, requiresGL: true });
