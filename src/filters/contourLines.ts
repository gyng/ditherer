import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderContourLinesGL, type ContourFillMode } from "./contourLinesGL";

const FILL_MODE = { LINES: "LINES", FILLED: "FILLED", BOTH: "BOTH" };

export const optionTypes = {
  levels: { type: RANGE, range: [3, 30], step: 1, default: 10, desc: "Number of contour levels" },
  lineWidth: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1, desc: "Contour line thickness in pixels" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Contour line color" },
  fillMode: { type: ENUM, options: [
    { name: "Lines only", value: FILL_MODE.LINES },
    { name: "Filled bands", value: FILL_MODE.FILLED },
    { name: "Lines + Fill", value: FILL_MODE.BOTH }
  ], default: FILL_MODE.BOTH, desc: "Show contour lines, filled bands, or both" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  fillMode: optionTypes.fillMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const contourLines = (input: any, options: typeof defaults = defaults) => {
  const { levels, lineWidth, lineColor, fillMode, palette } = options;
  const W = input.width, H = input.height;
  const fillInt = fillMode === FILL_MODE.LINES ? 0 : fillMode === FILL_MODE.FILLED ? 1 : 2;
  const rendered = renderContourLinesGL(
    input, W, H,
    levels, lineWidth,
    [lineColor[0], lineColor[1], lineColor[2]],
    fillInt as ContourFillMode,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Contour Lines", "WebGL2", `levels=${levels} lw=${lineWidth}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Contour Lines",
  func: contourLines,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
