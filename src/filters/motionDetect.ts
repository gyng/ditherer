import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const MODE = { WHITE: "WHITE", HEATMAP: "HEATMAP", SOURCE: "SOURCE" };

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 10, desc: "Minimum pixel change to register as motion" },
  sensitivity: { type: RANGE, range: [1, 10], step: 0.5, default: 3, desc: "Amplify detected motion intensity" },
  colorMode: {
    type: ENUM,
    options: [
      { name: "White on black", value: MODE.WHITE },
      { name: "Heatmap", value: MODE.HEATMAP },
      { name: "Source color", value: MODE.SOURCE },
    ],
    default: MODE.WHITE,
    desc: "How to visualize detected motion",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  sensitivity: optionTypes.sensitivity.default,
  colorMode: optionTypes.colorMode.default,
  animSpeed: optionTypes.animSpeed.default,
};

const motionDetect = (input, options: any = defaults) => {
  const { threshold, sensitivity, colorMode } = options;
  const ema: Float32Array | null = (options as any)._ema || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < buf.length; i += 4) {
    if (!ema) {
      // No EMA yet — pass through source dimmed
      outBuf[i] = Math.round(buf[i] * 0.3);
      outBuf[i + 1] = Math.round(buf[i + 1] * 0.3);
      outBuf[i + 2] = Math.round(buf[i + 2] * 0.3);
      outBuf[i + 3] = 255;
      continue;
    }

    const dr = Math.abs(buf[i] - ema[i]);
    const dg = Math.abs(buf[i + 1] - ema[i + 1]);
    const db = Math.abs(buf[i + 2] - ema[i + 2]);
    const diff = (dr + dg + db) / 3;

    if (diff < threshold) {
      outBuf[i + 3] = 255;
      continue;
    }

    const motion = Math.min(1, (diff - threshold) / 80 * sensitivity);

    if (colorMode === MODE.WHITE) {
      const v = Math.round(motion * 255);
      outBuf[i] = v; outBuf[i + 1] = v; outBuf[i + 2] = v;
    } else if (colorMode === MODE.HEATMAP) {
      // Blue → cyan → green → yellow → red
      const t = motion;
      outBuf[i]     = Math.round(t < 0.5 ? 0 : (t - 0.5) * 2 * 255);
      outBuf[i + 1] = Math.round(t < 0.25 ? t * 4 * 255 : t > 0.75 ? (1 - t) * 4 * 255 : 255);
      outBuf[i + 2] = Math.round(t < 0.5 ? (1 - t * 2) * 255 : 0);
    } else {
      // Source color
      outBuf[i] = buf[i]; outBuf[i + 1] = buf[i + 1]; outBuf[i + 2] = buf[i + 2];
    }
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Motion Detect", func: motionDetect, optionTypes, options: defaults, defaults, description: "Visualize motion from EMA background model — security camera or heat vision" };
