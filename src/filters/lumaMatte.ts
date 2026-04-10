import { RANGE, BOOL, ENUM } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const BG_MODE = {
  TRANSPARENT: "TRANSPARENT",
  BLACK: "BLACK",
  WHITE: "WHITE"
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance threshold used to build the matte" },
  feather: { type: RANGE, range: [0, 80], step: 1, default: 16, desc: "Soft transition width around the threshold" },
  invert: { type: BOOL, default: false, desc: "Flip which side of the threshold is kept" },
  backgroundMode: {
    type: ENUM,
    options: [
      { name: "Transparent", value: BG_MODE.TRANSPARENT },
      { name: "Black", value: BG_MODE.BLACK },
      { name: "White", value: BG_MODE.WHITE }
    ],
    default: BG_MODE.BLACK,
    desc: "What to show behind pixels rejected by the matte"
  }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  feather: optionTypes.feather.default,
  invert: optionTypes.invert.default,
  backgroundMode: optionTypes.backgroundMode.default
};

const lumaMatte = (input, options: any = defaults) => {
  const { threshold, feather, invert, backgroundMode } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(buf.length);
  const low = Math.max(0, threshold - feather);
  const high = Math.min(255, threshold + feather);
  const bgValue = backgroundMode === BG_MODE.WHITE ? 255 : 0;

  for (let i = 0; i < buf.length; i += 4) {
    const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    let mask = smoothstep(low, high, lum);
    if (invert) mask = 1 - mask;

    if (backgroundMode === BG_MODE.TRANSPARENT) {
      out[i] = buf[i];
      out[i + 1] = buf[i + 1];
      out[i + 2] = buf[i + 2];
      out[i + 3] = Math.round(mask * 255);
    } else {
      out[i] = Math.round(buf[i] * mask + bgValue * (1 - mask));
      out[i + 1] = Math.round(buf[i + 1] * mask + bgValue * (1 - mask));
      out[i + 2] = Math.round(buf[i + 2] * mask + bgValue * (1 - mask));
      out[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(out, W, H), 0, 0);
  return output;
};

export default {
  name: "Luma Matte",
  func: lumaMatte,
  optionTypes,
  options: defaults,
  defaults
};
