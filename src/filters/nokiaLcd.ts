import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderNokiaLcdGL } from "./nokiaLcdGL";

export const optionTypes = {
  columns: { type: RANGE, range: [42, 168], step: 1, default: 84, desc: "LCD horizontal pixel resolution" },
  rows: { type: RANGE, range: [24, 96], step: 1, default: 48, desc: "LCD vertical pixel resolution" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white threshold for 1-bit display" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.5, desc: "Contrast boost before thresholding" },
  pixelGrid: { type: BOOL, default: true, desc: "Show visible pixel grid lines" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columns: optionTypes.columns.default,
  rows: optionTypes.rows.default,
  threshold: optionTypes.threshold.default,
  contrast: optionTypes.contrast.default,
  pixelGrid: optionTypes.pixelGrid.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const nokiaLcd = (input: any, options: typeof defaults = defaults) => {
  const { columns, rows, threshold, contrast, pixelGrid, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderNokiaLcdGL(input, W, H, columns, rows, threshold, contrast, pixelGrid);
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
  requiresGL: true,
});
