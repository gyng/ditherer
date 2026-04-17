import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderLenticularGL } from "./lenticularGL";

export const optionTypes = {
  stripWidth: { type: RANGE, range: [2, 20], step: 1, default: 6, desc: "Width of each lenticular strip" },
  angle: { type: RANGE, range: [0, 360], step: 5, default: 0, desc: "Strip rotation angle in degrees" },
  sheenIntensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Holographic sheen strength" },
  rainbowSpread: { type: RANGE, range: [0, 3], step: 0.1, default: 1, desc: "Rainbow color spread across strips" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  stripWidth: optionTypes.stripWidth.default,
  angle: optionTypes.angle.default,
  sheenIntensity: optionTypes.sheenIntensity.default,
  rainbowSpread: optionTypes.rainbowSpread.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lenticular = (input: any, options: typeof defaults = defaults) => {
  const { stripWidth, angle, sheenIntensity, rainbowSpread, palette } = options;
  const W = input.width, H = input.height;
  const rad = (angle * Math.PI) / 180;

  const rendered = renderLenticularGL(input, W, H, stripWidth, sheenIntensity, rainbowSpread, rad);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Lenticular", "WebGL2", `strip=${stripWidth} angle=${angle}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Lenticular", func: lenticular, optionTypes, options: defaults, defaults, requiresGL: true });
