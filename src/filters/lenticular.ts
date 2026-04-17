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

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  const hh = ((h % 360) + 360) % 360;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
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

export default defineFilter({ name: "Lenticular", func: lenticular, optionTypes, options: defaults, defaults });
