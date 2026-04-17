import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderVintageTVGL } from "./vintageTVGL";

export const optionTypes = {
  banding: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Horizontal interference banding intensity" },
  colorFringe: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Color fringing/bleeding in pixels" },
  verticalRoll: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Vertical hold instability" },
  glow: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "CRT phosphor glow intensity" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  banding: optionTypes.banding.default,
  colorFringe: optionTypes.colorFringe.default,
  verticalRoll: optionTypes.verticalRoll.default,
  glow: optionTypes.glow.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const vintageTV = (
  input: any,
  options: typeof defaults & { _frameIndex?: number } = defaults
) => {
  const { banding, colorFringe, verticalRoll, glow, palette } = options;
  const frameIndex = options._frameIndex || 0;
  const W = input.width, H = input.height;
  const rollOffset = Math.round(verticalRoll * Math.sin(frameIndex * 0.1));

  const rendered = renderVintageTVGL(input, W, H, banding, colorFringe, rollOffset, frameIndex, glow);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Vintage TV", "WebGL2", `banding=${banding} fringe=${colorFringe}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Vintage TV",
  func: vintageTV,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
