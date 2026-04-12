import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

export const optionTypes = {
  baseSpeed: { type: RANGE, range: [0, 10], step: 0.5, default: 2, desc: "Hue rotation degrees per frame for static areas" },
  motionMultiplier: { type: RANGE, range: [0, 20], step: 1, default: 8, desc: "Extra hue rotation per unit of motion" },
  saturationBoost: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Boost saturation in moving areas" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  baseSpeed: optionTypes.baseSpeed.default,
  motionMultiplier: optionTypes.motionMultiplier.default,
  saturationBoost: optionTypes.saturationBoost.default,
  animSpeed: optionTypes.animSpeed.default,
};

// RGB ↔ HSL helpers (inline to avoid import overhead)
const rgb2hsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
    : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
};

const hue2rgb = (p: number, q: number, t: number) => {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
};

const hsl2rgb = (h: number, s: number, l: number): [number, number, number] => {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
};

type TemporalColorCycleOptions = FilterOptionValues & {
  baseSpeed?: number;
  motionMultiplier?: number;
  saturationBoost?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _frameIndex?: number;
};

const temporalColorCycle = (input, options: TemporalColorCycleOptions = defaults) => {
  const baseSpeed = Number(options.baseSpeed ?? defaults.baseSpeed);
  const motionMultiplier = Number(options.motionMultiplier ?? defaults.motionMultiplier);
  const saturationBoost = Number(options.saturationBoost ?? defaults.saturationBoost);
  const ema = options._ema ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const globalShift = frameIndex * baseSpeed;

  for (let i = 0; i < buf.length; i += 4) {
    const motion = ema
      ? (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 765
      : 0;

    const [hRaw, sRaw, l] = rgb2hsl(buf[i], buf[i + 1], buf[i + 2]);
    const h = hRaw + globalShift + motion * motionMultiplier * 30;
    const s = Math.min(1, sRaw + motion * saturationBoost);
    const [r, g, b] = hsl2rgb(h, s, l);
    outBuf[i] = r; outBuf[i + 1] = g; outBuf[i + 2] = b; outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Color Cycle", func: temporalColorCycle, optionTypes, options: defaults, defaults, mainThread: true, description: "Hue rotates over time — moving areas cycle faster creating rainbow trails" });
