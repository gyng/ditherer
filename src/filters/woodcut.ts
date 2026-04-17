import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";

import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderWoodcutGL } from "./woodcutGL";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white carving threshold" },
  lineWeight: { type: RANGE, range: [1, 5], step: 1, default: 2, desc: "Carved line thickness" },
  edgeStrength: { type: RANGE, range: [0, 3], step: 0.1, default: 1.5, desc: "Detail edge emphasis" },
  inkColor: { type: COLOR, default: [20, 15, 10], desc: "Ink color for printed areas" },
  paperColor: { type: COLOR, default: [240, 230, 210], desc: "Uncarved paper/wood color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  lineWeight: optionTypes.lineWeight.default,
  edgeStrength: optionTypes.edgeStrength.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const woodcut = (input: any, options: typeof defaults = defaults) => {
  const { threshold, lineWeight, edgeStrength, inkColor, paperColor, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderWoodcutGL(input, W, H,
      threshold, lineWeight, edgeStrength,
      [inkColor[0], inkColor[1], inkColor[2]],
      [paperColor[0], paperColor[1], paperColor[2]],);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Woodcut", "WebGL2", `t=${threshold} lw=${lineWeight}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Woodcut",
  func: woodcut,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
