import { RANGE, ENUM, COLOR, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const BG_MODE = { TRANSPARENT: "TRANSPARENT", SOLID: "SOLID", BLURRED: "BLURRED" };

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const optionTypes = {
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 20, desc: "Pixel difference to classify as foreground" },
  background: {
    type: ENUM,
    options: [
      { name: "Transparent", value: BG_MODE.TRANSPARENT },
      { name: "Solid color", value: BG_MODE.SOLID },
      { name: "Blurred source", value: BG_MODE.BLURRED },
    ],
    default: BG_MODE.TRANSPARENT,
    desc: "What to show behind the moving subject",
  },
  bgColor: { type: COLOR, default: [0, 0, 0, 255], desc: "Background color when using solid mode" },
  feather: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Soft edge around foreground mask" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  background: optionTypes.background.default,
  bgColor: optionTypes.bgColor.default,
  feather: optionTypes.feather.default,
  animSpeed: optionTypes.animSpeed.default,
};

const backgroundSubtraction = (input, options: any = defaults) => {
  const { threshold, background, bgColor, feather } = options;
  const ema: Float32Array | null = (options as any)._ema || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const edge0 = Math.max(0, threshold - feather);
  const edge1 = threshold + feather;
  const bgR = bgColor ? bgColor[0] : 0;
  const bgG = bgColor ? bgColor[1] : 0;
  const bgB = bgColor ? bgColor[2] : 0;

  for (let i = 0; i < buf.length; i += 4) {
    if (!ema) {
      // No EMA yet — pass through
      outBuf[i] = buf[i]; outBuf[i + 1] = buf[i + 1]; outBuf[i + 2] = buf[i + 2];
      outBuf[i + 3] = 255;
      continue;
    }

    const diff = (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 3;
    const mask = smoothstep(edge0, edge1, diff);

    if (background === BG_MODE.TRANSPARENT) {
      outBuf[i]     = buf[i];
      outBuf[i + 1] = buf[i + 1];
      outBuf[i + 2] = buf[i + 2];
      outBuf[i + 3] = Math.round(mask * 255);
    } else {
      // Solid or blurred — blend foreground with background
      outBuf[i]     = Math.round(buf[i] * mask + bgR * (1 - mask));
      outBuf[i + 1] = Math.round(buf[i + 1] * mask + bgG * (1 - mask));
      outBuf[i + 2] = Math.round(buf[i + 2] * mask + bgB * (1 - mask));
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Background Subtraction", func: backgroundSubtraction, optionTypes, options: defaults, defaults, mainThread: true, description: "Remove static background, keep only moving foreground — virtual green screen" };
