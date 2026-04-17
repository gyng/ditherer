import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderGradientMapGL } from "./gradientMapGL";

export const optionTypes = {
  color1: { type: COLOR, default: [0, 0, 40], desc: "Shadow color (darkest tones)" },
  color2: { type: COLOR, default: [200, 50, 50], desc: "Midtone color" },
  color3: { type: COLOR, default: [255, 220, 100], desc: "Highlight color (brightest tones)" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Blend with original image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  color3: optionTypes.color3.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const gradientMap = (input: any, options: typeof defaults = defaults) => {
  const { color1, color2, color3, mix, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderGradientMapGL(input, W, H,
      [color1[0], color1[1], color1[2]],
      [color2[0], color2[1], color2[2]],
      [color3[0], color3[1], color3[2]],
      mix,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Gradient Map", "WebGL2", identity ? "direct" : "direct+palettePass");
  return out ?? input;
};

export default defineFilter({
  name: "Gradient Map",
  func: gradientMap,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
