import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";
import { defineFilter } from "filters/types";

const BASELINE = {
  BLACK: "BLACK",
  ORIGINAL: "ORIGINAL"
};

export const optionTypes = {
  gain: { type: RANGE, range: [0.5, 5], step: 0.1, default: 2, desc: "Strength of the motion-reactive echo against the static background" },
  baseline: {
    type: ENUM,
    options: [
      { name: "Black", value: BASELINE.BLACK },
      { name: "Original", value: BASELINE.ORIGINAL }
    ],
    default: BASELINE.ORIGINAL,
    desc: "Whether the stable parts of the image stay visible or fall to black"
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  gain: optionTypes.gain.default,
  baseline: optionTypes.baseline.default,
  animSpeed: optionTypes.animSpeed.default,
};

const echoCombiner = (input: any, options = defaults) => {
  const { gain, baseline } = options;
  const ema: Float32Array | null = (options as { _ema?: Float32Array | null })._ema || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < buf.length; i += 4) {
    const baseR = baseline === BASELINE.ORIGINAL ? buf[i] : 0;
    const baseG = baseline === BASELINE.ORIGINAL ? buf[i + 1] : 0;
    const baseB = baseline === BASELINE.ORIGINAL ? buf[i + 2] : 0;

    if (!ema) {
      outBuf[i] = baseR;
      outBuf[i + 1] = baseG;
      outBuf[i + 2] = baseB;
      outBuf[i + 3] = 255;
      continue;
    }

    const dr = Math.abs(buf[i] - ema[i]) * gain;
    const dg = Math.abs(buf[i + 1] - ema[i + 1]) * gain;
    const db = Math.abs(buf[i + 2] - ema[i + 2]) * gain;

    outBuf[i] = Math.max(0, Math.min(255, Math.round(baseR + dr)));
    outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(baseG + dg)));
    outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(baseB + db)));
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Echo Combiner", func: echoCombiner, optionTypes, options: defaults, defaults, mainThread: true, description: "Amplify the difference from the recent average so moving regions resonate while static ones stay grounded" });
