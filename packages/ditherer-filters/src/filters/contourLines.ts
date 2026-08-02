import { RANGE, COLOR, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderContourLinesGL, type ContourFillMode } from "./contourLinesGL";

const FILL_MODE = { LINES: "LINES", FILLED: "FILLED", BOTH: "BOTH" };

export const optionTypes = {
  levels: {
    type: RANGE,
    range: [3, 30],
    step: 1,
    default: 10,
    desc: "Number of endpoint-preserving luminance bands",
  },
  lineWidth: {
    type: RANGE,
    range: [0.1, 4],
    step: 0.1,
    default: 1,
    desc: "Contour line thickness in pixels",
  },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Contour line color" },
  fillMode: {
    type: ENUM,
    options: [
      { name: "Lines only", value: FILL_MODE.LINES },
      { name: "Filled bands", value: FILL_MODE.FILLED },
      { name: "Lines + Fill", value: FILL_MODE.BOTH },
    ],
    default: FILL_MODE.BOTH,
    desc: "Show contour lines, filled bands, or both",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  levels: optionTypes.levels.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  fillMode: optionTypes.fillMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const validColor = (value: unknown, fallback: number[]): number[] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.slice(0, 3).every((channel) => Number.isFinite(Number(channel)))
    ? value.slice(0, 3).map((channel) => Math.max(0, Math.min(255, Number(channel))))
    : fallback;

const contourLines = (input: any, options: Partial<typeof defaults> = defaults) => {
  const levels = Math.round(finite(options.levels, defaults.levels, 3, 30));
  const lineWidth = finite(options.lineWidth, defaults.lineWidth, 0.1, 4);
  const lineColor = validColor(options.lineColor, defaults.lineColor);
  const fillMode = Object.values(FILL_MODE).includes(options.fillMode as string)
    ? (options.fillMode as string)
    : defaults.fillMode;
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;
  const fillInt = fillMode === FILL_MODE.LINES ? 0 : fillMode === FILL_MODE.FILLED ? 1 : 2;
  const rendered = renderContourLinesGL(
    input,
    W,
    H,
    levels,
    lineWidth,
    [lineColor[0], lineColor[1], lineColor[2]],
    fillInt as ContourFillMode,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Contour Lines",
    "WebGL2",
    `levels=${levels} lw=${lineWidth}${identity ? "" : "+palettePass"}`,
  );
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
