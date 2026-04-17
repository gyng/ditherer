import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderFractalGL } from "./fractalGL";

const FRACTAL_TYPE = {
  MANDELBROT: "MANDELBROT",
  JULIA: "JULIA"
};

const COLOR_SOURCE = {
  PALETTE: "PALETTE",
  IMAGE: "IMAGE"
};

export const optionTypes = {
  type: {
    type: ENUM,
    options: [
      { name: "Mandelbrot", value: FRACTAL_TYPE.MANDELBROT },
      { name: "Julia", value: FRACTAL_TYPE.JULIA }
    ],
    default: FRACTAL_TYPE.MANDELBROT,
    desc: "Fractal set to render"
  },
  zoom: { type: RANGE, range: [0.1, 50], step: 0.1, default: 1, desc: "Zoom level into the fractal" },
  centerX: { type: RANGE, range: [-2.5, 2.5], step: 0.01, default: -0.5, desc: "Horizontal center in complex plane" },
  centerY: { type: RANGE, range: [-2, 2], step: 0.01, default: 0, desc: "Vertical center in complex plane" },
  iterations: { type: RANGE, range: [10, 500], step: 10, default: 100, desc: "Max escape iterations — more = finer detail" },
  juliaR: { type: RANGE, range: [-2, 2], step: 0.01, default: -0.7, desc: "Julia set real component (c.r)" },
  juliaI: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.27, desc: "Julia set imaginary component (c.i)" },
  colorSource: {
    type: ENUM,
    options: [
      { name: "Palette", value: COLOR_SOURCE.PALETTE },
      { name: "Image", value: COLOR_SOURCE.IMAGE }
    ],
    default: COLOR_SOURCE.IMAGE,
    desc: "Color fractal from palette or source image"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  type: optionTypes.type.default,
  zoom: optionTypes.zoom.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  iterations: optionTypes.iterations.default,
  juliaR: optionTypes.juliaR.default,
  juliaI: optionTypes.juliaI.default,
  colorSource: optionTypes.colorSource.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const fractalFilter = (input: any, options: typeof defaults = defaults) => {
  const { type, zoom, centerX, centerY, iterations, juliaR, juliaI, colorSource, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderFractalGL(input, W, H,
      type === FRACTAL_TYPE.JULIA,
      colorSource === COLOR_SOURCE.IMAGE,
      zoom, centerX, centerY, iterations, juliaR, juliaI,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Fractal", "WebGL2", `type=${type} iter=${iterations}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Fractal",
  func: fractalFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
