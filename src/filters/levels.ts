import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  blackPoint: { type: RANGE, range: [0, 255], step: 1, default: 0 },
  whitePoint: { type: RANGE, range: [0, 255], step: 1, default: 255 },
  gamma: { type: RANGE, range: [0.1, 3], step: 0.05, default: 1 },
  outputBlack: { type: RANGE, range: [0, 255], step: 1, default: 0 },
  outputWhite: { type: RANGE, range: [0, 255], step: 1, default: 255 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  blackPoint: optionTypes.blackPoint.default,
  whitePoint: optionTypes.whitePoint.default,
  gamma: optionTypes.gamma.default,
  outputBlack: optionTypes.outputBlack.default,
  outputWhite: optionTypes.outputWhite.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const levelsFilter = (input, options: any = defaults) => {
  const { blackPoint, whitePoint, gamma, outputBlack, outputWhite, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Build lookup table for speed
  const lut = new Uint8Array(256);
  const inputRange = Math.max(1, whitePoint - blackPoint);
  const outputRange = outputWhite - outputBlack;

  for (let i = 0; i < 256; i++) {
    // Clamp to input range
    let normalized = (i - blackPoint) / inputRange;
    normalized = Math.max(0, Math.min(1, normalized));
    // Apply gamma
    normalized = Math.pow(normalized, 1 / gamma);
    // Map to output range
    lut[i] = Math.max(0, Math.min(255, Math.round(outputBlack + normalized * outputRange)));
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = lut[buf[i]];
      const g = lut[buf[i + 1]];
      const b = lut[buf[i + 2]];

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Levels",
  func: levelsFilter,
  optionTypes,
  options: defaults,
  defaults
};
