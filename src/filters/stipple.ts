import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderStippleGL } from "./stippleGL";

export const optionTypes = {
  density: { type: RANGE, range: [1, 20], step: 1, default: 4, desc: "Dot spacing — lower = denser stippling" },
  maxDotSize: { type: RANGE, range: [1, 8], step: 0.5, default: 3, desc: "Maximum stipple dot radius" },
  inkColor: { type: COLOR, default: [0, 0, 0], desc: "Stipple dot color" },
  paperColor: { type: COLOR, default: [255, 250, 240], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  maxDotSize: optionTypes.maxDotSize.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const stipple = (input: any, options: typeof defaults = defaults) => {
  const { density, maxDotSize, inkColor, paperColor, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderStippleGL(input, W, H, density, maxDotSize, inkColor, paperColor);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Stipple", "WebGL2", `density=${density} max=${maxDotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Stipple", func: stipple, optionTypes, options: defaults, defaults, requiresGL: true });
