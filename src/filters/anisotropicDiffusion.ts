import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderAnisotropicDiffusionGL } from "./anisotropicDiffusionGL";

const CONDUCTANCE_EXP = "EXP";
const CONDUCTANCE_QUADRATIC = "QUADRATIC";

export const optionTypes = {
  iterations: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Number of diffusion passes" },
  kappa: { type: RANGE, range: [1, 200], step: 1, default: 30, desc: "Edge sensitivity — higher preserves weaker edges" },
  lambda: { type: RANGE, range: [0.05, 0.25], step: 0.01, default: 0.2, desc: "Diffusion rate per iteration" },
  conductance: {
    type: ENUM,
    options: [
      { name: "Exponential (sharp edges)", value: CONDUCTANCE_EXP },
      { name: "Quadratic (wide edges)", value: CONDUCTANCE_QUADRATIC }
    ],
    default: CONDUCTANCE_EXP,
    desc: "Edge-stopping function shape"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  iterations: optionTypes.iterations.default,
  kappa: optionTypes.kappa.default,
  lambda: optionTypes.lambda.default,
  conductance: optionTypes.conductance.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const anisotropicDiffusion = (input: any, options: typeof defaults = defaults) => {
  const { iterations, kappa, lambda, conductance, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderAnisotropicDiffusionGL(input, W, H,
      iterations, kappa, lambda,
      conductance === CONDUCTANCE_EXP,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Anisotropic diffusion", "WebGL2", `iter=${iterations} kappa=${kappa}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Anisotropic diffusion",
  func: anisotropicDiffusion,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
