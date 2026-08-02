import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderColorHalftoneSeparateGL } from "./colorHalftoneSeparateGL";

export const optionTypes = {
  dotSize: {
    type: RANGE,
    range: [3, 16],
    step: 1,
    default: 6,
    label: "Screen pitch",
    desc: "Halftone screen pitch in pixels",
  },
  offsetR: {
    type: RANGE,
    range: [0, 10],
    step: 1,
    default: 2,
    desc: "Red plate horizontal misregistration",
  },
  offsetG: {
    type: RANGE,
    range: [0, 10],
    step: 1,
    default: 0,
    desc: "Green plate horizontal misregistration",
  },
  offsetB: {
    type: RANGE,
    range: [0, 10],
    step: 1,
    default: 3,
    desc: "Blue plate vertical misregistration",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  offsetR: optionTypes.offsetR.default,
  offsetG: optionTypes.offsetG.default,
  offsetB: optionTypes.offsetB.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const colorHalftoneSeparate = (input: any, options: typeof defaults = defaults) => {
  const normalized = { ...defaults, ...options };
  const finite = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const dotSize = Math.max(3, Math.min(16, finite(normalized.dotSize, defaults.dotSize)));
  const offsetR = Math.max(0, Math.min(10, finite(normalized.offsetR, defaults.offsetR)));
  const offsetG = Math.max(0, Math.min(10, finite(normalized.offsetG, defaults.offsetG)));
  const offsetB = Math.max(0, Math.min(10, finite(normalized.offsetB, defaults.offsetB)));
  const palette = normalized.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;

  const rendered = renderColorHalftoneSeparateGL(input, W, H, dotSize, offsetR, offsetG, offsetB);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Color Halftone Separate",
    "WebGL2",
    `dotSize=${dotSize}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Color Halftone Separate",
  func: colorHalftoneSeparate,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
