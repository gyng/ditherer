import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderFlowFieldGL } from "./flowFieldGL";

export const optionTypes = {
  scale: { type: RANGE, range: [5, 200], step: 5, default: 50, desc: "Flow noise feature size" },
  strength: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "Pixel displacement distance" },
  steps: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "Flow advection iterations" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for flow pattern" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  steps: optionTypes.steps.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const flowField = (input: any, options: typeof defaults = defaults) => {
  const { scale, strength, steps, seed, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderFlowFieldGL(input, W, H, scale, strength, steps, seed);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Flow Field", "WebGL2", `scale=${scale} strength=${strength} steps=${steps}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Flow Field", func: flowField, optionTypes, options: defaults, defaults, requiresGL: true });
