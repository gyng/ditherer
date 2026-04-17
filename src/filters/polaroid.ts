import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderPolaroidGL } from "./polaroidGL";

export const optionTypes = {
  warmth: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Warm color cast intensity" },
  fadedBlacks: { type: RANGE, range: [0, 50], step: 1, default: 20, desc: "Lift shadows for faded film look" },
  saturation: { type: RANGE, range: [0, 2], step: 0.05, default: 0.8, desc: "Color saturation level" },
  grain: { type: RANGE, range: [0, 0.5], step: 0.01, default: 0.08, desc: "Film grain noise amount" },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.35, desc: "Edge darkening intensity" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  warmth: optionTypes.warmth.default,
  fadedBlacks: optionTypes.fadedBlacks.default,
  saturation: optionTypes.saturation.default,
  grain: optionTypes.grain.default,
  vignette: optionTypes.vignette.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type PolaroidOptions = typeof defaults & { _frameIndex?: number };

const polaroid = (input: any, options: PolaroidOptions = defaults) => {
  const { warmth, fadedBlacks, saturation, grain, vignette, palette } = options;
  const frameIndex = options._frameIndex || 0;
  const W = input.width, H = input.height;
  const rendered = renderPolaroidGL(input, W, H, warmth, fadedBlacks, saturation, grain, vignette, frameIndex);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Polaroid", "WebGL2", `warmth=${warmth} grain=${grain}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Polaroid",
  func: polaroid,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
