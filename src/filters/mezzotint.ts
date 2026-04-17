import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderMezzotintGL } from "./mezzotintGL";

export const optionTypes = {
  density: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.5, desc: "Overall dot coverage density" },
  dotSize: { type: RANGE, range: [1, 3], step: 1, default: 1, desc: "Individual mezzotint dot size" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  dotSize: optionTypes.dotSize.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const mezzotint = (input: any, options: typeof defaults = defaults) => {
  const { density, dotSize, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderMezzotintGL(input, W, H, density, dotSize);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Mezzotint", "WebGL2", `density=${density} dotSize=${dotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Mezzotint", func: mezzotint, optionTypes, options: defaults, defaults });
