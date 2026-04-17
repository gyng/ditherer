import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderScanlineWarpGL } from "./scanlineWarpGL";

export const optionTypes = {
  amplitude: { type: RANGE, range: [0, 50], step: 1, default: 10, desc: "Horizontal wave displacement" },
  frequency: { type: RANGE, range: [0.1, 10], step: 0.1, default: 2, desc: "Wave oscillation frequency" },
  phase: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Wave phase offset in degrees" },
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
  amplitude: optionTypes.amplitude.default,
  frequency: optionTypes.frequency.default,
  phase: optionTypes.phase.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const scanlineWarp = (
  input: any,
  options: typeof defaults & { _frameIndex?: number } = defaults
) => {
  const { amplitude, frequency, phase, palette } = options;
  const frameIndex = options._frameIndex || 0;
  const W = input.width, H = input.height;
  const phaseRad = (phase * Math.PI) / 180;

  const rendered = renderScanlineWarpGL(input, W, H, amplitude, frequency, phaseRad + frameIndex * 0.2);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Scanline Warp", "WebGL2", `amp=${amplitude} freq=${frequency}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Scanline Warp",
  func: scanlineWarp,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
