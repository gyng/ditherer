import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 3], step: 0.1, default: 1.5, desc: "Intensity of the complementary ghost" },
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 20, desc: "Minimum scene change before a ghost appears" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  strength: optionTypes.strength.default,
  threshold: optionTypes.threshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

type AfterImageOptions = FilterOptionValues & {
  strength?: number;
  threshold?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
};

const afterImage = (input: any, options: AfterImageOptions = defaults) => {
  const strength = Number(options.strength ?? defaults.strength);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const ema = options._ema ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (!ema) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  // After-image: where the scene used to be brighter than it is now (something
  // bright moved away), show the complement of the OLD content blended in.
  // Uses EMA to track "what was here recently" — proper retinal-fatigue effect.
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const er = ema[i], eg = ema[i + 1], eb = ema[i + 2];

    // How much brightness was "lost" at this pixel relative to recent average
    const lumaLoss = ((er - r) + (eg - g) + (eb - b)) / 3;
    let ghost = 0;
    if (lumaLoss > threshold) {
      ghost = Math.min(1, (lumaLoss - threshold) / 80) * strength * 0.5;
    }

    // Complement of the EMA (what was recently there)
    const invR = 255 - er;
    const invG = 255 - eg;
    const invB = 255 - eb;

    outBuf[i]     = Math.min(255, Math.max(0, Math.round(r + (invR - r) * ghost)));
    outBuf[i + 1] = Math.min(255, Math.max(0, Math.round(g + (invG - g) * ghost)));
    outBuf[i + 2] = Math.min(255, Math.max(0, Math.round(b + (invB - b) * ghost)));
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "After-Image", func: afterImage, optionTypes, options: defaults, defaults, mainThread: true, description: "Complementary-colored ghost when bright objects move away — retinal fatigue simulation" });
