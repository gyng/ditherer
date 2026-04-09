import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const MODE = {
  MULTIPLY: "MULTIPLY",
  SCREEN: "SCREEN",
  OVERLAY: "OVERLAY",
  SOFT_LIGHT: "SOFT_LIGHT",
  HARD_LIGHT: "HARD_LIGHT",
  DIFFERENCE: "DIFFERENCE",
  EXCLUSION: "EXCLUSION"
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Multiply", value: MODE.MULTIPLY },
      { name: "Screen", value: MODE.SCREEN },
      { name: "Overlay", value: MODE.OVERLAY },
      { name: "Soft Light", value: MODE.SOFT_LIGHT },
      { name: "Hard Light", value: MODE.HARD_LIGHT },
      { name: "Difference", value: MODE.DIFFERENCE },
      { name: "Exclusion", value: MODE.EXCLUSION }
    ],
    default: MODE.MULTIPLY
  },
  color: { type: COLOR, default: [200, 150, 100] },
  opacity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  color: optionTypes.color.default,
  opacity: optionTypes.opacity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Blend mode math (all operate on 0-255 values)
const blendChannel = (a: number, b: number, mode: string): number => {
  const an = a / 255;
  const bn = b / 255;
  let result: number;

  switch (mode) {
    case MODE.MULTIPLY:
      result = an * bn;
      break;
    case MODE.SCREEN:
      result = 1 - (1 - an) * (1 - bn);
      break;
    case MODE.OVERLAY:
      result = an < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn);
      break;
    case MODE.SOFT_LIGHT:
      result = bn < 0.5
        ? an - (1 - 2 * bn) * an * (1 - an)
        : an + (2 * bn - 1) * (Math.sqrt(an) - an);
      break;
    case MODE.HARD_LIGHT:
      result = bn < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn);
      break;
    case MODE.DIFFERENCE:
      result = Math.abs(an - bn);
      break;
    case MODE.EXCLUSION:
      result = an + bn - 2 * an * bn;
      break;
    default:
      result = an;
  }

  return Math.round(Math.max(0, Math.min(1, result)) * 255);
};

const blendFilter = (input, options: any = defaults) => {
  const { mode, color, opacity, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      const br = blendChannel(buf[i], color[0], mode);
      const bg = blendChannel(buf[i + 1], color[1], mode);
      const bb = blendChannel(buf[i + 2], color[2], mode);

      // Lerp with original by opacity
      const r = Math.round(buf[i] + (br - buf[i]) * opacity);
      const g = Math.round(buf[i + 1] + (bg - buf[i + 1]) * opacity);
      const b = Math.round(buf[i + 2] + (bb - buf[i + 2]) * opacity);

      const c = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, c[0], c[1], c[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Blend",
  func: blendFilter,
  optionTypes,
  options: defaults,
  defaults
};
