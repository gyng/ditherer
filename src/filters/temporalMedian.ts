import { ACTION, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

let historyFrames: Uint8ClampedArray[] = [];
let historyHead = 0;
let historyWidth = 0;
let historyHeight = 0;
let historyDepth = 0;
let lastFrameIndex = -1;

const resetHistory = (width: number, height: number, depth: number) => {
  historyFrames = [];
  historyHead = 0;
  historyWidth = width;
  historyHeight = height;
  historyDepth = depth;
};

const insertionSort = (values: number[], length: number) => {
  for (let i = 1; i < length; i++) {
    const value = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
};

const medianFromHistory = (
  frames: Uint8ClampedArray[],
  filled: number,
  pixelIndex: number,
  scratch: number[]
) => {
  for (let i = 0; i < filled; i++) {
    scratch[i] = frames[i][pixelIndex];
  }
  insertionSort(scratch, filled);
  return scratch[Math.floor(filled * 0.5)];
};

export const optionTypes = {
  windowSize: {
    type: RANGE,
    range: [3, 9],
    step: 2,
    default: 5,
    desc: "How many recent frames participate in the temporal median consensus",
  },
  animSpeed: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 15,
    desc: "Playback speed when using the built-in animation toggle",
  },
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
  windowSize: optionTypes.windowSize.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalMedianOptions = FilterOptionValues & {
  windowSize?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const temporalMedian = (input, options: TemporalMedianOptions = defaults) => {
  const windowSize = Math.max(3, Math.round(Number(options.windowSize ?? defaults.windowSize)));
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
    historyWidth !== width ||
    historyHeight !== height ||
    historyDepth !== windowSize ||
    restartedAnimation
  ) {
    resetHistory(width, height, windowSize);
  }
  lastFrameIndex = frameIndex;

  historyFrames[historyHead % windowSize] = new Uint8ClampedArray(source);
  historyHead += 1;

  const filled = Math.min(historyHead, windowSize);
  const activeFrames = historyFrames.slice(0, filled);
  const outBuf = new Uint8ClampedArray(source.length);
  const scratchR = new Array<number>(filled);
  const scratchG = new Array<number>(filled);
  const scratchB = new Array<number>(filled);

  for (let i = 0; i < source.length; i += 4) {
    outBuf[i] = medianFromHistory(activeFrames, filled, i, scratchR);
    outBuf[i + 1] = medianFromHistory(activeFrames, filled, i + 1, scratchG);
    outBuf[i + 2] = medianFromHistory(activeFrames, filled, i + 2, scratchB);
    outBuf[i + 3] = source[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Time Median",
  func: temporalMedian,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Take the per-pixel median across recent frames to suppress brief motion and flicker while preserving stable structure",
});
