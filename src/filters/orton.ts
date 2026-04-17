import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderOrtonGL } from "./ortonGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 40], step: 1, default: 12, desc: "Gaussian blur sigma for the glow copy" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Opacity of the dreamy screen-blended glow" },
  contrast: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Midtone contrast lift after the screen blend washes things out" },
  saturation: { type: RANGE, range: [0, 2], step: 0.05, default: 1.2, desc: "Saturation multiplier — Orton looks lean a little warmer/richer" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  saturation: optionTypes.saturation.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const orton = (input: any, options: typeof defaults = defaults) => {
  const { radius, strength, contrast, saturation, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderOrtonGL(input, W, H, radius, strength, contrast, saturation);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Orton", "WebGL2", `radius=${radius} strength=${strength}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Orton",
  func: orton,
  optionTypes,
  options: defaults,
  defaults,
  description: "Dreamy diffusion glow — screen-blends a gaussian-blurred copy over the source for a soft, painterly photo look",
  requiresGL: true });
