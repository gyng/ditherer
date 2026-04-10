import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const MODE = { MAX: "MAX", ADDITIVE: "ADDITIVE", AVERAGE: "AVERAGE" };

export const optionTypes = {
  decay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.05, desc: "How fast trails fade — lower = longer trails" },
  mode: {
    type: ENUM,
    options: [
      { name: "Max (keep brightest)", value: MODE.MAX },
      { name: "Additive (accumulate light)", value: MODE.ADDITIVE },
      { name: "Average (running mean)", value: MODE.AVERAGE },
    ],
    default: MODE.MAX,
    desc: "How light accumulates across frames",
  },
  brightnessThreshold: { type: RANGE, range: [0, 255], step: 5, default: 30, desc: "Only accumulate pixels brighter than this" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  decay: optionTypes.decay.default,
  mode: optionTypes.mode.default,
  brightnessThreshold: optionTypes.brightnessThreshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

const longExposure = (input, options: any = defaults) => {
  const { decay, mode, brightnessThreshold } = options;
  const prevOutput: Uint8ClampedArray | null = (options as any)._prevOutput || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const oneMinusDecay = 1 - decay;

  for (let i = 0; i < buf.length; i += 4) {
    const srcLum = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
    const aboveThreshold = srcLum >= brightnessThreshold;
    const pr = prevOutput ? prevOutput[i] : 0;
    const pg = prevOutput ? prevOutput[i + 1] : 0;
    const pb = prevOutput ? prevOutput[i + 2] : 0;

    if (mode === MODE.MAX) {
      outBuf[i]     = aboveThreshold ? Math.max(buf[i], Math.round(pr * oneMinusDecay)) : Math.round(pr * oneMinusDecay);
      outBuf[i + 1] = aboveThreshold ? Math.max(buf[i + 1], Math.round(pg * oneMinusDecay)) : Math.round(pg * oneMinusDecay);
      outBuf[i + 2] = aboveThreshold ? Math.max(buf[i + 2], Math.round(pb * oneMinusDecay)) : Math.round(pb * oneMinusDecay);
    } else if (mode === MODE.ADDITIVE) {
      const add = aboveThreshold ? 0.3 : 0;
      outBuf[i]     = Math.min(255, Math.round(pr * oneMinusDecay + buf[i] * add));
      outBuf[i + 1] = Math.min(255, Math.round(pg * oneMinusDecay + buf[i + 1] * add));
      outBuf[i + 2] = Math.min(255, Math.round(pb * oneMinusDecay + buf[i + 2] * add));
    } else {
      // Average
      outBuf[i]     = Math.round(pr * oneMinusDecay + buf[i] * decay);
      outBuf[i + 1] = Math.round(pg * oneMinusDecay + buf[i + 1] * decay);
      outBuf[i + 2] = Math.round(pb * oneMinusDecay + buf[i + 2] * decay);
    }
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Long Exposure", func: longExposure, optionTypes, options: defaults, defaults, mainThread: true, description: "Accumulate bright pixels over time — moving lights leave trails" };
