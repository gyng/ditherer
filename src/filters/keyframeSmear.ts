import { ACTION, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";

let keyframeBuf: Uint8ClampedArray | null = null;
let keyframeWidth = 0;
let keyframeHeight = 0;
let keyframeIntervalCache = 0;
let framesSinceCapture = 0;
let lastFrameIndex = -1;

const resetKeyframe = (source: Uint8ClampedArray, width: number, height: number, interval: number) => {
  keyframeBuf = new Uint8ClampedArray(source);
  keyframeWidth = width;
  keyframeHeight = height;
  keyframeIntervalCache = interval;
  framesSinceCapture = 0;
};

export const optionTypes = {
  keyframeInterval: { type: RANGE, range: [2, 30], step: 1, default: 8, desc: "How many frames pass before a new keyframe is captured" },
  smear: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "How strongly the held keyframe drags into the in-between frames" },
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
  keyframeInterval: optionTypes.keyframeInterval.default,
  smear: optionTypes.smear.default,
  animSpeed: optionTypes.animSpeed.default,
};

const keyframeSmear = (input, options: any = defaults) => {
  const keyframeInterval = Math.max(2, Math.round(Number(options.keyframeInterval ?? defaults.keyframeInterval)));
  const smear = Math.max(0, Math.min(1, Number(options.smear ?? defaults.smear)));
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
    !keyframeBuf ||
    keyframeWidth !== width ||
    keyframeHeight !== height ||
    keyframeIntervalCache !== keyframeInterval ||
    restartedAnimation
  ) {
    resetKeyframe(source, width, height, keyframeInterval);
  } else if (framesSinceCapture >= keyframeInterval) {
    resetKeyframe(source, width, height, keyframeInterval);
  }
  lastFrameIndex = frameIndex;

  const phase = Math.min(1, framesSinceCapture / Math.max(1, keyframeInterval));
  const smearMix = smear * (1 - phase * 0.45);
  const outBuf = new Uint8ClampedArray(source.length);

  for (let i = 0; i < source.length; i += 4) {
    outBuf[i] = Math.round(keyframeBuf![i] * smearMix + source[i] * (1 - smearMix));
    outBuf[i + 1] = Math.round(keyframeBuf![i + 1] * smearMix + source[i + 1] * (1 - smearMix));
    outBuf[i + 2] = Math.round(keyframeBuf![i + 2] * smearMix + source[i + 2] * (1 - smearMix));
    outBuf[i + 3] = source[i + 3];
  }

  framesSinceCapture += 1;
  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default {
  name: "Keyframe Smear",
  func: keyframeSmear,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Capture sparse keyframes and drag them through the in-between frames for compressed, smeared temporal interpolation",
};
