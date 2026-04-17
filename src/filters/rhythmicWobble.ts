import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderRhythmicWobbleGL } from "./rhythmicWobbleGL";

export const optionTypes = {
  amountX: { type: RANGE, range: [0, 40], step: 1, default: 6, desc: "Maximum horizontal wobble in pixels" },
  amountY: { type: RANGE, range: [0, 40], step: 1, default: 4, desc: "Maximum vertical wobble in pixels" },
  rotation: { type: RANGE, range: [0, 12], step: 0.1, default: 1.2, desc: "Maximum rotational wobble in degrees" },
  zoomJitter: { type: RANGE, range: [0, 0.25], step: 0.01, default: 0.04, desc: "Subtle zoom breathing mixed into the wobble" },
  frequency: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1.2, desc: "How quickly the periodic wobble evolves over time" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amountX: optionTypes.amountX.default,
  amountY: optionTypes.amountY.default,
  rotation: optionTypes.rotation.default,
  zoomJitter: optionTypes.zoomJitter.default,
  frequency: optionTypes.frequency.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const samplePhase = (frameIndex: number, frequency: number, seed: number) =>
  frameIndex * frequency * 0.14 + seed;

type RhythmicWobbleOptions = typeof defaults & { _frameIndex?: number };

const rhythmicWobble = (input: any, options: RhythmicWobbleOptions = defaults) => {
  const { amountX, amountY, rotation, zoomJitter, frequency, palette } = options;
  const frameIndex = options._frameIndex || 0;
  const W = input.width, H = input.height;

  const phaseX = samplePhase(frameIndex, frequency, 0.37);
  const phaseY = samplePhase(frameIndex, frequency, 1.91);
  const phaseR = samplePhase(frameIndex, frequency, 2.73);
  const offsetX = Math.sin(phaseX) * amountX + Math.sin(phaseX * 2.31) * amountX * 0.35;
  const offsetY = Math.cos(phaseY) * amountY + Math.sin(phaseY * 1.73) * amountY * 0.35;
  const angle = (
    Math.sin(phaseR) * rotation +
    Math.cos(phaseR * 1.87) * rotation * 0.45
  ) * (Math.PI / 180);
  const zoom = 1 + Math.sin(samplePhase(frameIndex, frequency, 4.12)) * zoomJitter;

  const rendered = renderRhythmicWobbleGL(input, W, H, offsetX, offsetY, angle, zoom);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Rhythmic Wobble", "WebGL2", `offsetX=${offsetX.toFixed(2)} offsetY=${offsetY.toFixed(2)}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Rhythmic Wobble",
  func: rhythmicWobble,
  optionTypes,
  options: defaults,
  defaults,
  description: "Periodic whole-frame wobble with sinusoidal drift and gentle zoom breathing",
  requiresGL: true,
});
