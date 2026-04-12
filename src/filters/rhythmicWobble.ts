import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

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

const rhythmicWobble = (input: any, options = defaults) => {
  const { amountX, amountY, rotation, zoomJitter, frequency, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);

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

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cx = (width - 1) * 0.5;
  const cy = (height - 1) * 0.5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - cx) / zoom;
      const dy = (y - cy) / zoom;
      const srcX = Math.max(0, Math.min(width - 1, Math.round(cx + dx * cosA - dy * sinA + offsetX)));
      const srcY = Math.max(0, Math.min(height - 1, Math.round(cy + dx * sinA + dy * cosA + offsetY)));
      const srcI = (srcY * width + srcX) * 4;
      const dstI = (y * width + x) * 4;

      const color = paletteGetColor(palette, [
        buf[srcI],
        buf[srcI + 1],
        buf[srcI + 2],
        buf[srcI + 3]
      ], palette.options, false);

      outBuf[dstI] = color[0];
      outBuf[dstI + 1] = color[1];
      outBuf[dstI + 2] = color[2];
      outBuf[dstI + 3] = color[3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Rhythmic Wobble",
  func: rhythmicWobble,
  optionTypes,
  options: defaults,
  defaults,
  description: "Periodic whole-frame wobble with sinusoidal drift and gentle zoom breathing"
});
