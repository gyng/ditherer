import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderColorGradientNoiseGL } from "./colorGradientNoiseGL";

export const optionTypes = {
  scale: { type: RANGE, range: [5, 200], step: 1, default: 50, desc: "Noise feature size in pixels" },
  color1: { type: COLOR, default: [20, 0, 80], desc: "First gradient endpoint color" },
  color2: { type: COLOR, default: [255, 100, 50], desc: "Second gradient endpoint color" },
  mix: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Blend amount with source image" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for noise pattern" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  mix: optionTypes.mix.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorGradientNoise = (
  input: any,
  options: typeof defaults = defaults
) => {
  const {
    scale,
    color1,
    color2,
    mix,
    seed,
    palette
  } = options;

  const W = input.width;
  const H = input.height;

  const rendered = renderColorGradientNoiseGL(input, W, H, scale,
      [color1[0], color1[1], color1[2]],
      [color2[0], color2[1], color2[2]],
      mix, seed,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Color Gradient Noise", "WebGL2", `scale=${scale} mix=${mix}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Color Gradient Noise",
  func: colorGradientNoise,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
