import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderNewspaperGL } from "./newspaperGL";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, label: "Screen pitch", desc: "Spacing of the newspaper halftone screen in pixels" },
  screenAngle: { type: RANGE, range: [-90, 90], step: 1, default: 45, desc: "Halftone screen angle in degrees — 45° is traditional for monochrome photographs" },
  yellowing: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Aged newsprint yellowing" },
  foldCrease: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Visible fold crease intensity" },
  inkSmear: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Fixed per-dot displacement from ink spread and paper roughness" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  screenAngle: optionTypes.screenAngle.default,
  yellowing: optionTypes.yellowing.default,
  foldCrease: optionTypes.foldCrease.default,
  inkSmear: optionTypes.inkSmear.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const newspaper = (input: any, options: Partial<typeof defaults> = defaults) => {
  const {
    dotSize = defaults.dotSize,
    screenAngle = defaults.screenAngle,
    yellowing = defaults.yellowing,
    foldCrease = defaults.foldCrease,
    inkSmear = defaults.inkSmear,
    palette = defaults.palette,
  } = options;
  const W = input.width, H = input.height;
  const rendered = renderNewspaperGL(input, W, H, dotSize, screenAngle, yellowing, foldCrease, inkSmear);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Newspaper", "WebGL2", `dotSize=${dotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Newspaper",
  func: newspaper,
  optionTypes,
  options: defaults,
  defaults,
  description: "Static monochrome newsprint screening with a 45° dot lattice, local tone sampling, paper yellowing, and fixed ink displacement",
  requiresGL: true,
});
