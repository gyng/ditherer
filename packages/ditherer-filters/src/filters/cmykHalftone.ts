import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderCmykHalftoneGL } from "./cmykHalftoneGL";

export const optionTypes = {
  dotSize: {
    type: RANGE,
    range: [2, 20],
    step: 1,
    default: 6,
    label: "Screen pitch",
    desc: "Screen spacing (cell pitch) in pixels",
  },
  angleC: {
    type: RANGE,
    range: [0, 180],
    step: 5,
    default: 15,
    desc: "Cyan screen angle in degrees",
  },
  angleM: {
    type: RANGE,
    range: [0, 180],
    step: 5,
    default: 75,
    desc: "Magenta screen angle in degrees",
  },
  angleY: {
    type: RANGE,
    range: [0, 180],
    step: 5,
    default: 0,
    desc: "Yellow screen angle in degrees",
  },
  angleK: {
    type: RANGE,
    range: [0, 180],
    step: 5,
    default: 45,
    desc: "Black (key) screen angle in degrees",
  },
  paperColor: { type: COLOR, default: [255, 250, 245], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  angleC: optionTypes.angleC.default,
  angleM: optionTypes.angleM.default,
  angleY: optionTypes.angleY.default,
  angleK: optionTypes.angleK.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const validColor = (value: unknown, fallback: number[]): number[] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.slice(0, 3).every((channel) => typeof channel === "number" && Number.isFinite(channel))
    ? value.slice(0, 3).map((channel) => Math.max(0, Math.min(255, channel)))
    : fallback;

const cmykHalftone = (input: any, options: Partial<typeof defaults> = defaults) => {
  const dotSize = Math.round(finite(options.dotSize, defaults.dotSize, 2, 20));
  const angleC = finite(options.angleC, defaults.angleC, 0, 180);
  const angleM = finite(options.angleM, defaults.angleM, 0, 180);
  const angleY = finite(options.angleY, defaults.angleY, 0, 180);
  const angleK = finite(options.angleK, defaults.angleK, 0, 180);
  const paperColor = validColor(options.paperColor, defaults.paperColor);
  const palette = options.palette ?? defaults.palette;
  const W = input.width;
  const H = input.height;

  const rendered = renderCmykHalftoneGL(input, W, H, dotSize, angleC, angleM, angleY, angleK, [
    paperColor[0],
    paperColor[1],
    paperColor[2],
  ]);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "CMYK Halftone",
    "WebGL2",
    `dotSize=${dotSize}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "CMYK Halftone",
  func: cmykHalftone,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
