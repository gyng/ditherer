import { RANGE, BOOL, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderNokiaLcdGL } from "./nokiaLcdGL";

export const optionTypes = {
  columns: { type: RANGE, range: [42, 168], step: 1, default: 84, desc: "LCD horizontal pixel resolution" },
  rows: { type: RANGE, range: [24, 96], step: 1, default: 48, desc: "LCD vertical pixel resolution" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white threshold for 1-bit display" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.25, desc: "Contrast boost before thresholding" },
  ditherStrength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "Display-native 4×4 ordered decisions that preserve tone using only the two physical LCD states" },
  pixelGrid: { type: BOOL, default: true, desc: "Show visible pixel grid lines" },
  palette: { type: PALETTE, default: nearest, desc: "Optional palette remapping after the two-state LCD rendering" }
};

export const defaults = {
  columns: optionTypes.columns.default,
  rows: optionTypes.rows.default,
  threshold: optionTypes.threshold.default,
  contrast: optionTypes.contrast.default,
  ditherStrength: optionTypes.ditherStrength.default,
  pixelGrid: optionTypes.pixelGrid.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const nokiaLcd = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const { columns, rows, threshold, contrast, ditherStrength, pixelGrid, palette } = resolved;
  const W = input.width, H = input.height;
  const rendered = renderNokiaLcdGL(
    input, W, H, columns, rows, threshold, contrast, ditherStrength, pixelGrid,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Nokia LCD", "WebGL2", `${columns}x${rows}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Nokia LCD",
  func: nokiaLcd,
  optionTypes,
  options: defaults,
  defaults,
  description: "PCD8544-style 84×48 two-state LCD with display-grid ordered dithering and preserved green optical states",
  requiresGL: true,
});
