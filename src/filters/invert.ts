import { BOOL } from "constants/controlTypes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { renderInvertGL } from "./invertGL";

export const optionTypes = {
  invertR: { type: BOOL, default: true, desc: "Invert red channel" },
  invertG: { type: BOOL, default: true, desc: "Invert green channel" },
  invertB: { type: BOOL, default: true, desc: "Invert blue channel" },
  invertA: { type: BOOL, default: false, desc: "Invert alpha channel" }
};

export const defaults = {
  invertR: optionTypes.invertR.default,
  invertG: optionTypes.invertG.default,
  invertB: optionTypes.invertB.default,
  invertA: optionTypes.invertA.default
};

const invert = (input: any, options: typeof defaults = defaults) => {
  const W = input.width, H = input.height;
  const rendered = renderInvertGL(input, W, H, options.invertR, options.invertG, options.invertB, options.invertA);
  if (!rendered) return input;
  logFilterBackend("Invert", "WebGL2", `r=${options.invertR ? 1 : 0} g=${options.invertG ? 1 : 0} b=${options.invertB ? 1 : 0} a=${options.invertA ? 1 : 0}`);
  return rendered;
};

export default defineFilter({
  name: "Invert",
  func: invert,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
