import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderMorphologyGL, type MorphMode } from "./morphologyGL";

const MODE = { DILATE: "DILATE", ERODE: "ERODE", OPEN: "OPEN", CLOSE: "CLOSE" };

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Dilate", value: MODE.DILATE },
    { name: "Erode", value: MODE.ERODE },
    { name: "Open (erode then dilate)", value: MODE.OPEN },
    { name: "Close (dilate then erode)", value: MODE.CLOSE }
  ], default: MODE.DILATE, desc: "Morphological operation type" },
  radius: { type: RANGE, range: [1, 10], step: 1, default: 2, desc: "Structuring element radius" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const morphology = (input: any, options: typeof defaults = defaults) => {
  const { mode, radius, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderMorphologyGL(input, W, H, mode as MorphMode, radius);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Dilate / Erode", "WebGL2", `mode=${mode} r=${radius}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Dilate / Erode", func: morphology, optionTypes, options: defaults, defaults, requiresGL: true });
