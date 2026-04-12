import { RANGE, BOOL, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

export const optionTypes = {
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 15, desc: "Minimum temporal change to show as an edge" },
  sensitivity: { type: RANGE, range: [1, 10], step: 0.5, default: 3, desc: "Amplify edge brightness" },
  accumulate: { type: BOOL, default: true, desc: "Build up edges over time vs show only instantaneous changes" },
  decayRate: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.08, desc: "How fast accumulated edges fade" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  sensitivity: optionTypes.sensitivity.default,
  accumulate: optionTypes.accumulate.default,
  decayRate: optionTypes.decayRate.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalEdgeOptions = FilterOptionValues & {
  threshold?: number;
  sensitivity?: number;
  accumulate?: boolean;
  decayRate?: number;
  animSpeed?: number;
  _prevInput?: Uint8ClampedArray | null;
  _prevOutput?: Uint8ClampedArray | null;
};

const temporalEdge = (input, options: TemporalEdgeOptions = defaults) => {
  const threshold = Number(options.threshold ?? defaults.threshold);
  const sensitivity = Number(options.sensitivity ?? defaults.sensitivity);
  const accumulate = Boolean(options.accumulate ?? defaults.accumulate);
  const decayRate = Number(options.decayRate ?? defaults.decayRate);
  const prevInput = options._prevInput ?? null;
  const prevOutput = options._prevOutput ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < buf.length; i += 4) {
    let edgeR = 0, edgeG = 0, edgeB = 0;

    if (prevInput) {
      const dr = Math.abs(buf[i] - prevInput[i]);
      const dg = Math.abs(buf[i + 1] - prevInput[i + 1]);
      const db = Math.abs(buf[i + 2] - prevInput[i + 2]);

      if (dr > threshold) edgeR = Math.min(255, (dr - threshold) * sensitivity);
      if (dg > threshold) edgeG = Math.min(255, (dg - threshold) * sensitivity);
      if (db > threshold) edgeB = Math.min(255, (db - threshold) * sensitivity);
    }

    if (accumulate && prevOutput) {
      // Blend with decaying previous output
      const decay = 1 - decayRate;
      edgeR = Math.min(255, Math.max(edgeR, Math.round(prevOutput[i] * decay)));
      edgeG = Math.min(255, Math.max(edgeG, Math.round(prevOutput[i + 1] * decay)));
      edgeB = Math.min(255, Math.max(edgeB, Math.round(prevOutput[i + 2] * decay)));
    }

    outBuf[i] = edgeR; outBuf[i + 1] = edgeG; outBuf[i + 2] = edgeB;
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Temporal Edge", func: temporalEdge, optionTypes, options: defaults, defaults, mainThread: true, description: "Detect edges in time — moving edges glow, static edges are invisible" });
