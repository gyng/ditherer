import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";

import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderPosterizeEdgesGL } from "./posterizeEdgesGL";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5, desc: "Color posterization levels" },
  edgeThreshold: { type: RANGE, range: [0, 100], step: 1, default: 25, desc: "Edge detection sensitivity" },
  edgeWidth: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Edge outline thickness" },
  edgeColor: { type: COLOR, default: [0, 0, 0], desc: "Edge outline color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  edgeThreshold: optionTypes.edgeThreshold.default,
  edgeWidth: optionTypes.edgeWidth.default,
  edgeColor: optionTypes.edgeColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const posterizeEdges = (input: any, options: typeof defaults = defaults) => {
  const { levels, edgeThreshold, edgeWidth, edgeColor, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderPosterizeEdgesGL(input, W, H,
      levels, edgeThreshold, edgeWidth,
      [edgeColor[0], edgeColor[1], edgeColor[2]],);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Posterize Edges", "WebGL2", `levels=${levels} edge>${edgeThreshold}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Posterize Edges",
  func: posterizeEdges,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
