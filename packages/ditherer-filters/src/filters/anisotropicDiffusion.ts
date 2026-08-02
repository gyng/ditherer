import { RANGE, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderAnisotropicDiffusionGL } from "./anisotropicDiffusionGL";
import { glUnavailableStub } from "../gl/index";

const CONDUCTANCE_EXP = "EXP";
const CONDUCTANCE_QUADRATIC = "QUADRATIC";

export const optionTypes = {
  iterations: {
    type: RANGE,
    range: [1, 50],
    step: 1,
    default: 10,
    desc: "Number of diffusion passes",
  },
  kappa: {
    type: RANGE,
    range: [1, 200],
    step: 1,
    default: 30,
    desc: "Edge threshold — lower preserves weaker edges; higher smooths across stronger transitions",
  },
  lambda: {
    type: RANGE,
    range: [0.05, 0.25],
    step: 0.01,
    default: 0.2,
    desc: "Diffusion rate per iteration",
  },
  conductance: {
    type: ENUM,
    options: [
      { name: "Exponential (sharp edges)", value: CONDUCTANCE_EXP },
      { name: "Quadratic (wide edges)", value: CONDUCTANCE_QUADRATIC },
    ],
    default: CONDUCTANCE_EXP,
    desc: "Edge-stopping function shape",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  iterations: optionTypes.iterations.default,
  kappa: optionTypes.kappa.default,
  lambda: optionTypes.lambda.default,
  conductance: optionTypes.conductance.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const anisotropicDiffusion = (input: any, options: Partial<typeof defaults> = defaults) => {
  const iterations = Math.round(finite(options.iterations, defaults.iterations, 1, 50));
  const kappa = finite(options.kappa, defaults.kappa, 1, 200);
  const lambda = finite(options.lambda, defaults.lambda, 0.05, 0.25);
  const conductance =
    options.conductance === CONDUCTANCE_QUADRATIC ? CONDUCTANCE_QUADRATIC : CONDUCTANCE_EXP;
  const palette = options.palette ?? defaults.palette;
  const W = input.width;
  const H = input.height;

  const rendered = renderAnisotropicDiffusionGL(
    input,
    W,
    H,
    iterations,
    kappa,
    lambda,
    conductance === CONDUCTANCE_EXP,
  );
  if (!rendered) return glUnavailableStub(W, H);
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Anisotropic diffusion",
    "WebGL2",
    `iter=${iterations} kappa=${kappa}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Anisotropic diffusion",
  func: anisotropicDiffusion,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
