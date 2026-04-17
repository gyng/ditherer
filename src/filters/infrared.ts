import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderInfraredGL } from "./infraredGL";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Infrared effect strength" },
  falseColor: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "False-color mapping intensity" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  falseColor: optionTypes.falseColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const infrared = (input: any, options: typeof defaults = defaults) => {
  const { intensity, falseColor, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderInfraredGL(input, W, H, intensity, falseColor);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Infrared", "WebGL2", `intensity=${intensity}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Infrared", func: infrared, optionTypes, options: defaults, defaults, requiresGL: true });
