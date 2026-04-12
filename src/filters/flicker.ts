import { ACTION, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

const MODE = {
  LIVE_GHOST: "LIVE_GHOST",
  STROBE: "STROBE",
  HOLD_FLASH: "HOLD_FLASH",
} as const;

let heldABuf: Uint8ClampedArray | null = null;
let heldWidth = 0;
let heldHeight = 0;
let lastFrameIndex = -1;

const resetState = (source: Uint8ClampedArray, width: number, height: number) => {
  heldABuf = new Uint8ClampedArray(source);
  heldWidth = width;
  heldHeight = height;
};

export const optionTypes = {
  mode: {
    type: ENUM,
    default: MODE.LIVE_GHOST,
    options: [
      { name: "Live ghost", value: MODE.LIVE_GHOST },
      { name: "Strobe", value: MODE.STROBE },
      { name: "Hold flash", value: MODE.HOLD_FLASH },
    ],
    desc: "Flicker model: live ghosting, hard strobe brightness, or held-frame flashing",
  },
  amount: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.7,
    desc: "Overall flicker intensity",
  },
  flash: {
    type: RANGE,
    range: [0.5, 2.5],
    step: 0.05,
    default: 1.5,
    desc: "Brightness multiplier on the flashed beat",
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
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  mode: optionTypes.mode.default,
  amount: optionTypes.amount.default,
  flash: optionTypes.flash.default,
  animSpeed: optionTypes.animSpeed.default,
};

type FlickerOptions = FilterOptionValues & {
  mode?: string;
  amount?: number;
  flash?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const flicker = (input: any, options: FlickerOptions = defaults) => {
  const mode = options.mode || defaults.mode;
  const amount = Math.max(0, Math.min(1, Number(options.amount ?? defaults.amount)));
  const flash = Math.max(0, Number(options.flash ?? defaults.flash));
  const frameIndex = Number(options._frameIndex ?? 0);
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const source = inputCtx.getImageData(0, 0, width, height).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;
  const phase = ((frameIndex % 3) + 3) % 3;

  if (!heldABuf || heldWidth !== width || heldHeight !== height || restartedAnimation) {
    resetState(source, width, height);
  }
  lastFrameIndex = frameIndex;

  if (phase === 0) {
    resetState(source, width, height);
  }

  if (phase !== 2) {
    outputCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0);
    return output;
  }

  const outBuf = new Uint8ClampedArray(source.length);
  for (let i = 0; i < source.length; i += 4) {
    let r = source[i];
    let g = source[i + 1];
    let b = source[i + 2];

    if (mode === MODE.LIVE_GHOST && heldABuf) {
      r = heldABuf[i] * amount + source[i] * (1 - amount);
      g = heldABuf[i + 1] * amount + source[i + 1] * (1 - amount);
      b = heldABuf[i + 2] * amount + source[i + 2] * (1 - amount);
      r *= flash;
      g *= flash;
      b *= flash;
    } else if (mode === MODE.STROBE) {
      const pulse = 1 + amount * (flash - 1);
      r *= pulse;
      g *= pulse;
      b *= pulse;
    } else if (mode === MODE.HOLD_FLASH && heldABuf) {
      r = heldABuf[i] * amount + source[i] * (1 - amount * 0.5);
      g = heldABuf[i + 1] * amount + source[i + 1] * (1 - amount * 0.5);
      b = heldABuf[i + 2] * amount + source[i + 2] * (1 - amount * 0.5);
      const pulse = 1 + amount * (flash - 1);
      r *= pulse;
      g *= pulse;
      b *= pulse;
    }

    outBuf[i] = Math.max(0, Math.min(255, Math.round(r)));
    outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    outBuf[i + 3] = source[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Flicker",
  func: flicker,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Aggressive projector/monitor flicker with live ghost, strobe, and held-frame flash modes",
});
