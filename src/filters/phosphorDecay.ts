import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

export const optionTypes = {
  redDecay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.15, desc: "Red channel persistence — higher = faster fade" },
  greenDecay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.05, desc: "Green channel persistence — slowest (like real P22 phosphors)" },
  blueDecay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.2, desc: "Blue channel persistence — fastest fade" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  redDecay: optionTypes.redDecay.default,
  greenDecay: optionTypes.greenDecay.default,
  blueDecay: optionTypes.blueDecay.default,
  animSpeed: optionTypes.animSpeed.default,
};

type PhosphorDecayOptions = FilterOptionValues & {
  redDecay?: number;
  greenDecay?: number;
  blueDecay?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const phosphorDecay = (input: any, options: PhosphorDecayOptions = defaults) => {
  const redDecay = Number(options.redDecay ?? defaults.redDecay);
  const greenDecay = Number(options.greenDecay ?? defaults.greenDecay);
  const blueDecay = Number(options.blueDecay ?? defaults.blueDecay);
  const prevOutput = options._prevOutput ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rRetain = 1 - redDecay;
  const gRetain = 1 - greenDecay;
  const bRetain = 1 - blueDecay;

  for (let i = 0; i < buf.length; i += 4) {
    if (prevOutput) {
      // Each channel: keep whichever is brighter — current input or decayed previous
      outBuf[i]     = Math.max(buf[i], Math.round(prevOutput[i] * rRetain));
      outBuf[i + 1] = Math.max(buf[i + 1], Math.round(prevOutput[i + 1] * gRetain));
      outBuf[i + 2] = Math.max(buf[i + 2], Math.round(prevOutput[i + 2] * bRetain));
    } else {
      outBuf[i] = buf[i]; outBuf[i + 1] = buf[i + 1]; outBuf[i + 2] = buf[i + 2];
    }
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Phosphor Decay", func: phosphorDecay, optionTypes, options: defaults, defaults, description: "CRT phosphor persistence — each RGB channel decays at a different rate" , temporal: true });
