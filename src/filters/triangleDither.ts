import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas } from "palettes/backend";
import { renderTriangleDitherGL } from "./triangleDitherGL";

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  palette: optionTypes.palette.default
};

// Shader adds TPDF noise, then quantises to LEVELS when the palette is
// LEVELS-only. Custom-colour palettes skip shader quantise (pass
// levels=256) and run the standard post-readout palette pass to do the
// colour-distance snap on CPU.
const triangleDither = (input: any, options: typeof defaults = defaults) => {
  const { palette } = options;
  const W = input.width, H = input.height;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const seed = (Math.random() * 0xffffffff) >>> 0 || 1;
  const hasCustomColors = Array.isArray(paletteOpts?.colors) && (paletteOpts!.colors as unknown[]).length > 0;
  const levelsForShader = hasCustomColors ? 256 : (paletteOpts?.levels ?? 256);
  const rendered = renderTriangleDitherGL(input, W, H, seed, levelsForShader);
  if (!rendered) return input;
  const out = hasCustomColors ? applyPalettePassToCanvas(rendered, W, H, palette) : rendered;
  logFilterBackend("Triangle dither", "WebGL2", hasCustomColors ? "noise+palettePass" : `levels=${levelsForShader}`);
  return out ?? input;
};

export default defineFilter({
  name: "Triangle dither",
  func: triangleDither,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
