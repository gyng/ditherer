import { ACTION, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

let heldBands: Uint8Array | null = null;
let holdPressure: Float32Array | null = null;
let heldWidth = 0;
let heldHeight = 0;
let heldLevels = 0;
let lastFrameIndex = -1;

const resetState = (width: number, height: number, levels: number) => {
  heldBands = new Uint8Array(width * height);
  holdPressure = new Float32Array(width * height);
  heldWidth = width;
  heldHeight = height;
  heldLevels = levels;
};

const quantizeBand = (luma: number, levels: number) =>
  Math.max(0, Math.min(levels - 1, Math.round((luma / 255) * (levels - 1))));

const bandToLuma = (band: number, levels: number) =>
  levels <= 1 ? 0 : (band / (levels - 1)) * 255;

export const optionTypes = {
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5, desc: "Number of posterized tone bands in the held result" },
  holdThreshold: { type: RANGE, range: [0, 96], step: 1, default: 18, desc: "Tone change required before a held band begins to release" },
  releaseSpeed: { type: RANGE, range: [0.05, 1], step: 0.05, default: 0.25, desc: "How quickly a conflicting tone pushes the held band to update" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  levels: optionTypes.levels.default,
  holdThreshold: optionTypes.holdThreshold.default,
  releaseSpeed: optionTypes.releaseSpeed.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalPosterHoldOptions = FilterOptionValues & {
  levels?: number;
  holdThreshold?: number;
  releaseSpeed?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const temporalPosterHold = (input, options: TemporalPosterHoldOptions = defaults) => {
  const levels = Math.max(2, Math.round(Number(options.levels ?? defaults.levels)));
  const holdThreshold = Math.max(0, Number(options.holdThreshold ?? defaults.holdThreshold));
  const releaseSpeed = Math.max(0.01, Number(options.releaseSpeed ?? defaults.releaseSpeed));
  const frameIndex = Number(options._frameIndex ?? 0);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const source = inputCtx.getImageData(0, 0, width, height).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;

  if (
    !heldBands ||
    !holdPressure ||
    heldWidth !== width ||
    heldHeight !== height ||
    heldLevels !== levels ||
    restartedAnimation
  ) {
    resetState(width, height, levels);
  }
  lastFrameIndex = frameIndex;

  const outBuf = new Uint8ClampedArray(source.length);

  for (let i = 0; i < source.length; i += 4) {
    const pixelIndex = i >> 2;
    const luma = 0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2];
    const targetBand = quantizeBand(luma, levels);
    const currentBand = heldBands![pixelIndex];

    if (frameIndex === 0 && currentBand === 0 && holdPressure![pixelIndex] === 0) {
      heldBands![pixelIndex] = targetBand;
    } else if (targetBand === currentBand) {
      holdPressure![pixelIndex] = Math.max(0, holdPressure![pixelIndex] - releaseSpeed * 0.5);
    } else {
      const currentLuma = bandToLuma(currentBand, levels);
      const targetLuma = bandToLuma(targetBand, levels);
      const delta = Math.abs(targetLuma - currentLuma);
      if (delta > holdThreshold) {
        const push = ((delta - holdThreshold) / Math.max(1, 255 - holdThreshold)) + 0.15;
        holdPressure![pixelIndex] += push * releaseSpeed;
        if (holdPressure![pixelIndex] >= 1) {
          heldBands![pixelIndex] = targetBand;
          holdPressure![pixelIndex] = 0;
        }
      } else {
        holdPressure![pixelIndex] = Math.max(0, holdPressure![pixelIndex] - releaseSpeed * 0.25);
      }
    }

    const heldLuma = bandToLuma(heldBands![pixelIndex], levels);
    const srcLuma = Math.max(1, luma);
    const scale = heldLuma / srcLuma;

    outBuf[i] = Math.max(0, Math.min(255, Math.round(source[i] * scale)));
    outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(source[i + 1] * scale)));
    outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(source[i + 2] * scale)));
    outBuf[i + 3] = source[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Poster Hold",
  func: temporalPosterHold,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Posterized tone bands update with temporal hysteresis so broad regions stick before snapping to a new tone",
});
