import { ACTION, ENUM, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const MODE = {
  BLEND: "BLEND",
  SHUTTER: "SHUTTER",
  MAX: "MAX",
  ADDITIVE: "ADDITIVE",
  RUNNING_AVERAGE: "RUNNING_AVERAGE",
};

let shutterFrames: Uint8ClampedArray[] = [];
let shutterHead = 0;
let shutterW = 0;
let shutterH = 0;
let shutterWindow = 0;

const resetShutterState = (width: number, height: number, windowSize: number) => {
  if (shutterW !== width || shutterH !== height || shutterWindow !== windowSize) {
    shutterFrames = [];
    shutterHead = 0;
    shutterW = width;
    shutterH = height;
    shutterWindow = windowSize;
  }
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Blend", value: MODE.BLEND },
      { name: "Shutter average", value: MODE.SHUTTER },
      { name: "Long exposure max", value: MODE.MAX },
      { name: "Long exposure additive", value: MODE.ADDITIVE },
      { name: "Running average", value: MODE.RUNNING_AVERAGE },
    ],
    default: MODE.BLEND,
    desc: "Choose between soft ghosting, slow-shutter averaging, or brighter long-exposure accumulation",
  },
  blendFactor: {
    type: RANGE,
    range: [0.1, 0.95],
    step: 0.05,
    default: 0.7,
    desc: "Weight of the previous frame in blend mode",
    visibleWhen: (options) => options.mode === MODE.BLEND,
  },
  windowSize: {
    type: RANGE,
    range: [2, 30],
    step: 1,
    default: 8,
    desc: "How many recent frames get averaged in shutter mode",
    visibleWhen: (options) => options.mode === MODE.SHUTTER,
  },
  decay: {
    type: RANGE,
    range: [0.01, 0.3],
    step: 0.01,
    default: 0.05,
    desc: "How fast old light fades in accumulation modes",
    visibleWhen: (options) => options.mode !== MODE.SHUTTER,
  },
  brightnessThreshold: {
    type: RANGE,
    range: [0, 255],
    step: 5,
    default: 30,
    desc: "Only accumulate pixels brighter than this in long-exposure modes",
    visibleWhen: (options) => options.mode === MODE.MAX || options.mode === MODE.ADDITIVE,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  mode: optionTypes.mode.default,
  blendFactor: optionTypes.blendFactor.default,
  windowSize: optionTypes.windowSize.default,
  decay: optionTypes.decay.default,
  brightnessThreshold: optionTypes.brightnessThreshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

const temporalExposure = (input, options: any = defaults) => {
  const { mode, blendFactor, windowSize, decay, brightnessThreshold } = options;
  const prevOutput: Uint8ClampedArray | null = options._prevOutput || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (mode === MODE.SHUTTER) {
    resetShutterState(W, H, windowSize);
    shutterFrames[shutterHead % windowSize] = new Uint8ClampedArray(buf);
    shutterHead += 1;
    const filled = Math.min(shutterHead, windowSize);

    for (let i = 0; i < buf.length; i += 4) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let f = 0; f < filled; f += 1) {
        const frame = shutterFrames[f];
        r += frame[i];
        g += frame[i + 1];
        b += frame[i + 2];
      }
      outBuf[i] = Math.round(r / filled);
      outBuf[i + 1] = Math.round(g / filled);
      outBuf[i + 2] = Math.round(b / filled);
      outBuf[i + 3] = 255;
    }

    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  const oneMinusDecay = 1 - decay;
  const blendCurrentWeight = 1 - blendFactor;

  for (let i = 0; i < buf.length; i += 4) {
    const prevR = prevOutput ? prevOutput[i] : 0;
    const prevG = prevOutput ? prevOutput[i + 1] : 0;
    const prevB = prevOutput ? prevOutput[i + 2] : 0;

    if (mode === MODE.BLEND) {
      if (prevOutput) {
        outBuf[i] = Math.round(prevR * blendFactor + buf[i] * blendCurrentWeight);
        outBuf[i + 1] = Math.round(prevG * blendFactor + buf[i + 1] * blendCurrentWeight);
        outBuf[i + 2] = Math.round(prevB * blendFactor + buf[i + 2] * blendCurrentWeight);
      } else {
        outBuf[i] = buf[i];
        outBuf[i + 1] = buf[i + 1];
        outBuf[i + 2] = buf[i + 2];
      }
    } else if (mode === MODE.MAX || mode === MODE.ADDITIVE) {
      const srcLum = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      const aboveThreshold = srcLum >= brightnessThreshold;
      if (mode === MODE.MAX) {
        outBuf[i] = aboveThreshold ? Math.max(buf[i], Math.round(prevR * oneMinusDecay)) : Math.round(prevR * oneMinusDecay);
        outBuf[i + 1] = aboveThreshold ? Math.max(buf[i + 1], Math.round(prevG * oneMinusDecay)) : Math.round(prevG * oneMinusDecay);
        outBuf[i + 2] = aboveThreshold ? Math.max(buf[i + 2], Math.round(prevB * oneMinusDecay)) : Math.round(prevB * oneMinusDecay);
      } else {
        const add = aboveThreshold ? 0.3 : 0;
        outBuf[i] = Math.min(255, Math.round(prevR * oneMinusDecay + buf[i] * add));
        outBuf[i + 1] = Math.min(255, Math.round(prevG * oneMinusDecay + buf[i + 1] * add));
        outBuf[i + 2] = Math.min(255, Math.round(prevB * oneMinusDecay + buf[i + 2] * add));
      }
    } else {
      outBuf[i] = Math.round(prevR * oneMinusDecay + buf[i] * decay);
      outBuf[i + 1] = Math.round(prevG * oneMinusDecay + buf[i + 1] * decay);
      outBuf[i + 2] = Math.round(prevB * oneMinusDecay + buf[i + 2] * decay);
    }

    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Long Exposure",
  func: temporalExposure,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Blend, average, or accumulate recent frames for ghost trails, slow-shutter smear, and long-exposure light painting",
};
