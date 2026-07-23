import { RANGE, PALETTE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderThermalPrinterGL } from "./thermalPrinterGL";

export const optionTypes = {
  resolution: { type: RANGE, range: [50, 400], step: 10, default: 200, desc: "Print resolution in pixels wide" },
  fadeGradient: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Thermal fade toward paper edges" },
  dotDensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Heat/density response of each fixed print-head dot" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette; defaults to binary receipt-paper tones" }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  fadeGradient: optionTypes.fadeGradient.default,
  dotDensity: optionTypes.dotDensity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

type ThermalPrinterOptions = FilterOptionValues & {
  resolution?: number;
  fadeGradient?: number;
  dotDensity?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
};

const thermalPrinter = (input: any, options: ThermalPrinterOptions = defaults) => {
  const {
    resolution = defaults.resolution,
    fadeGradient = defaults.fadeGradient,
    dotDensity = defaults.dotDensity,
    palette = defaults.palette,
  } = options;
  const W = input.width, H = input.height;
  const scale = Math.max(1, Math.round(W / resolution));
  const rendered = renderThermalPrinterGL(input, W, H, scale, fadeGradient, dotDensity);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Thermal Printer", "WebGL2", `res=${resolution} density=${dotDensity}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Thermal Printer",
  func: thermalPrinter,
  optionTypes,
  options: defaults,
  defaults,
  description: "Static direct-thermal receipt print on a discrete line-head dot lattice with density response and edge fading",
  requiresGL: true,
});
