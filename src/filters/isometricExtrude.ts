import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderIsometricExtrudeGL } from "./isometricExtrudeGL";

const DIRECTION = {
  NE: "NE",
  NW: "NW",
  SE: "SE",
  SW: "SW"
};

export const optionTypes = {
  depth: { type: RANGE, range: [1, 24], step: 1, default: 8, desc: "How far the pixel slabs extrude in isometric space" },
  direction: {
    type: ENUM,
    options: [
      { name: "North-East", value: DIRECTION.NE },
      { name: "North-West", value: DIRECTION.NW },
      { name: "South-East", value: DIRECTION.SE },
      { name: "South-West", value: DIRECTION.SW }
    ],
    default: DIRECTION.NE,
    desc: "Direction the slabs extrude toward"
  },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 12, desc: "Skip near-black or near-transparent pixels below this luma threshold" },
  shadowColor: { type: COLOR, default: [32, 24, 20], desc: "Color of the extrusion side wall / shadow" },
  shadeFalloff: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "How quickly the side wall fades with depth" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  depth: optionTypes.depth.default,
  direction: optionTypes.direction.default,
  threshold: optionTypes.threshold.default,
  shadowColor: optionTypes.shadowColor.default,
  shadeFalloff: optionTypes.shadeFalloff.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const directionVector = (direction: string) => {
  switch (direction) {
    case DIRECTION.NW: return [-1, -1];
    case DIRECTION.SE: return [1, 1];
    case DIRECTION.SW: return [-1, 1];
    default: return [1, -1];
  }
};

const isometricExtrude = (input: any, options: typeof defaults = defaults) => {
  const { depth, direction, threshold, shadowColor, shadeFalloff, palette } = options;
  const W = input.width, H = input.height;
  const [stepX, stepY] = directionVector(direction);
  const rendered = renderIsometricExtrudeGL(
    input, W, H, depth, stepX, stepY, threshold, shadowColor, shadeFalloff,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Isometric Extrude", "WebGL2", `depth=${depth} dir=${direction}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Isometric Extrude",
  func: isometricExtrude,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
