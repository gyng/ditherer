import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderGaussianBlurGL } from "./gaussianBlurGL";

export const optionTypes = {
  sigma: { type: RANGE, range: [0.5, 20], step: 0.5, default: 3, desc: "Blur radius — higher values produce a softer image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  sigma: optionTypes.sigma.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const gaussianBlurFilter = (input: any, options: typeof defaults = defaults) => {
  const { sigma, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderGaussianBlurGL(input, W, H, sigma);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Gaussian Blur", "WebGL2", `sigma=${sigma}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Gaussian Blur",
  func: gaussianBlurFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
