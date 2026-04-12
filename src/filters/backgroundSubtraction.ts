import { ACTION, COLOR, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

const MODE = {
  FOREGROUND: "FOREGROUND",
  BACKGROUND: "BACKGROUND",
  FREEZE_STILL: "FREEZE_STILL",
};

const BACKGROUND = {
  TRANSPARENT: "TRANSPARENT",
  SOLID: "SOLID",
  SOURCE_DIM: "SOURCE_DIM",
};

const FROZEN = {
  FIRST: "FIRST",
  AVERAGE: "AVERAGE",
};

let frozenFrame: Uint8ClampedArray | null = null;
let frozenAccum: Float32Array | null = null;
let frozenCount = 0;
let frozenW = 0;
let frozenH = 0;
let frozenMode = "";

const smoothstep = (edge0: number, edge1: number, x: number) => {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const ensureFrozenState = (buf: Uint8ClampedArray, width: number, height: number, frozenFrameMode: string) => {
  if (!frozenFrame || frozenW !== width || frozenH !== height || frozenMode !== frozenFrameMode) {
    frozenFrame = new Uint8ClampedArray(buf);
    frozenAccum = new Float32Array(buf.length);
    frozenCount = 0;
    frozenW = width;
    frozenH = height;
    frozenMode = frozenFrameMode;
  }

  if (frozenFrameMode === FROZEN.AVERAGE) {
    for (let i = 0; i < buf.length; i += 1) {
      frozenAccum![i] += buf[i];
      frozenFrame![i] = Math.round(frozenAccum![i] / Math.max(1, frozenCount + 1));
    }
    frozenCount += 1;
  }
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Foreground", value: MODE.FOREGROUND },
      { name: "Background", value: MODE.BACKGROUND },
      { name: "Freeze still areas", value: MODE.FREEZE_STILL },
    ],
    default: MODE.FOREGROUND,
    desc: "Keep moving subjects, reveal the stable background, or freeze still regions while motion stays live",
  },
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 20, desc: "Pixel difference needed to classify a region as moving" },
  feather: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Soft edge around the motion mask" },
  background: {
    type: ENUM,
    options: [
      { name: "Transparent", value: BACKGROUND.TRANSPARENT },
      { name: "Solid color", value: BACKGROUND.SOLID },
      { name: "Dim source", value: BACKGROUND.SOURCE_DIM },
    ],
    default: BACKGROUND.TRANSPARENT,
    desc: "What to show behind the moving subject in foreground mode",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.FOREGROUND,
  },
  bgColor: {
    type: COLOR,
    default: [0, 0, 0, 255],
    desc: "Background color when using solid background mode",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.FOREGROUND && options.background === BACKGROUND.SOLID,
  },
  learnRate: {
    type: RANGE,
    range: [0.001, 0.1],
    step: 0.001,
    default: 0.02,
    desc: "How quickly the reconstructed background adapts to new static content",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.BACKGROUND,
  },
  frozenFrame: {
    type: ENUM,
    options: [
      { name: "First", value: FROZEN.FIRST },
      { name: "Average", value: FROZEN.AVERAGE },
    ],
    default: FROZEN.FIRST,
    desc: "Reference image used for frozen regions in freeze-still mode",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.FREEZE_STILL,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  mode: optionTypes.mode.default,
  threshold: optionTypes.threshold.default,
  feather: optionTypes.feather.default,
  background: optionTypes.background.default,
  bgColor: optionTypes.bgColor.default,
  learnRate: optionTypes.learnRate.default,
  frozenFrame: optionTypes.frozenFrame.default,
  animSpeed: optionTypes.animSpeed.default,
};

type BackgroundSubtractionOptions = FilterOptionValues & {
  mode?: string;
  threshold?: number;
  feather?: number;
  background?: string;
  bgColor?: number[];
  learnRate?: number;
  frozenFrame?: string;
  animSpeed?: number;
  _ema?: Float32Array | null;
};

const sceneSeparation = (input: any, options: BackgroundSubtractionOptions = defaults) => {
  const mode = String(options.mode ?? defaults.mode);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const feather = Number(options.feather ?? defaults.feather);
  const background = String(options.background ?? defaults.background);
  const bgColor = Array.isArray(options.bgColor) ? options.bgColor : defaults.bgColor;
  const learnRate = Number(options.learnRate ?? defaults.learnRate);
  const frozenFrameMode = String(options.frozenFrame ?? defaults.frozenFrame);
  const ema = options._ema ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (mode === MODE.FREEZE_STILL) {
    ensureFrozenState(buf, W, H, frozenFrameMode);
  }

  const edge0 = Math.max(0, threshold - feather);
  const edge1 = threshold + feather;
  const bgR = bgColor ? bgColor[0] : 0;
  const bgG = bgColor ? bgColor[1] : 0;
  const bgB = bgColor ? bgColor[2] : 0;
  const bgBlend = Math.max(0, Math.min(1, learnRate * 12));

  for (let i = 0; i < buf.length; i += 4) {
    if (!ema) {
      outBuf[i] = buf[i];
      outBuf[i + 1] = buf[i + 1];
      outBuf[i + 2] = buf[i + 2];
      outBuf[i + 3] = 255;
      continue;
    }

    const diff = (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 3;
    const moving = smoothstep(edge0, edge1, diff);
    const still = 1 - moving;

    if (mode === MODE.BACKGROUND) {
      outBuf[i] = Math.round(ema[i] * still + (ema[i] * (1 - bgBlend) + buf[i] * bgBlend) * moving);
      outBuf[i + 1] = Math.round(ema[i + 1] * still + (ema[i + 1] * (1 - bgBlend) + buf[i + 1] * bgBlend) * moving);
      outBuf[i + 2] = Math.round(ema[i + 2] * still + (ema[i + 2] * (1 - bgBlend) + buf[i + 2] * bgBlend) * moving);
      outBuf[i + 3] = 255;
      continue;
    }

    if (mode === MODE.FREEZE_STILL) {
      outBuf[i] = Math.round(frozenFrame![i] * still + buf[i] * moving);
      outBuf[i + 1] = Math.round(frozenFrame![i + 1] * still + buf[i + 1] * moving);
      outBuf[i + 2] = Math.round(frozenFrame![i + 2] * still + buf[i + 2] * moving);
      outBuf[i + 3] = 255;
      continue;
    }

    if (background === BACKGROUND.TRANSPARENT) {
      outBuf[i] = buf[i];
      outBuf[i + 1] = buf[i + 1];
      outBuf[i + 2] = buf[i + 2];
      outBuf[i + 3] = Math.round(moving * 255);
    } else if (background === BACKGROUND.SOURCE_DIM) {
      outBuf[i] = Math.round(buf[i] * moving + buf[i] * 0.2 * still);
      outBuf[i + 1] = Math.round(buf[i + 1] * moving + buf[i + 1] * 0.2 * still);
      outBuf[i + 2] = Math.round(buf[i + 2] * moving + buf[i + 2] * 0.2 * still);
      outBuf[i + 3] = 255;
    } else {
      outBuf[i] = Math.round(buf[i] * moving + bgR * still);
      outBuf[i + 1] = Math.round(buf[i + 1] * moving + bgG * still);
      outBuf[i + 2] = Math.round(buf[i + 2] * moving + bgB * still);
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Scene Separation",
  func: sceneSeparation,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Separate moving and static regions to isolate foreground, reconstruct the background, or freeze still parts of the scene",
});
