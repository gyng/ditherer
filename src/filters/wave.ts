import { RANGE, PALETTE, BOOL } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderWaveGL } from "./waveGL";

export const optionTypes = {
  amplitudeX: { type: RANGE, range: [0, 100], step: 0.5, default: 10, desc: "Max horizontal displacement in pixels" },
  frequencyX: { type: RANGE, range: [0, 0.2], step: 0.001, default: 0.02, desc: "Horizontal wave frequency (cycles per pixel)" },
  amplitudeY: { type: RANGE, range: [0, 100], step: 0.5, default: 0, desc: "Max vertical displacement in pixels" },
  frequencyY: { type: RANGE, range: [0, 0.2], step: 0.001, default: 0.02, desc: "Vertical wave frequency (cycles per pixel)" },
  phaseX: { type: RANGE, range: [0, 6.28], step: 0.01, default: 0, desc: "Phase offset for horizontal wave (0 to 2pi)" },
  phaseY: { type: RANGE, range: [0, 6.28], step: 0.01, default: 0, desc: "Phase offset for vertical wave (0 to 2pi)" },
  diagonal: { type: BOOL, default: false, desc: "Drive waves along diagonal (x+y) instead of axes" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amplitudeX: optionTypes.amplitudeX.default,
  frequencyX: optionTypes.frequencyX.default,
  amplitudeY: optionTypes.amplitudeY.default,
  frequencyY: optionTypes.frequencyY.default,
  phaseX: optionTypes.phaseX.default,
  phaseY: optionTypes.phaseY.default,
  diagonal: optionTypes.diagonal.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const wave = (input: any, options: typeof defaults = defaults) => {
  const { amplitudeX, frequencyX, amplitudeY, frequencyY, phaseX, phaseY, diagonal, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderWaveGL(input, W, H,
      amplitudeX, frequencyX, amplitudeY, frequencyY,
      phaseX, phaseY, diagonal,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Wave", "WebGL2", `ampX=${amplitudeX} ampY=${amplitudeY}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Wave",
  func: wave,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
