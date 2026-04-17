import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderSmudgeGL } from "./smudgeGL";

export const optionTypes = {
  strength: { type: RANGE, range: [1, 30], step: 1, default: 10, desc: "Smudge distance in pixels" },
  direction: { type: RANGE, range: [0, 360], step: 5, default: 90, desc: "Smudge direction in degrees" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  direction: optionTypes.direction.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const smudge = (input: any, options: typeof defaults = defaults) => {
  const { strength, direction, palette } = options;
  const W = input.width, H = input.height;
  const rad = (direction * Math.PI) / 180;
  const rendered = renderSmudgeGL(input, W, H, strength, rad);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Smudge", "WebGL2", `strength=${strength} dir=${direction}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Smudge",
  func: smudge,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
