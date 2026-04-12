import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  linearPaletteGetColor
} from "utils";

export const optionTypes = {
  blackPoint: { type: RANGE, range: [0, 255], step: 1, default: 0, desc: "Input shadow clipping point" },
  whitePoint: { type: RANGE, range: [0, 255], step: 1, default: 255, desc: "Input highlight clipping point" },
  gamma: { type: RANGE, range: [0.1, 3], step: 0.05, default: 1, desc: "Midtone gamma curve (>1 brightens, <1 darkens)" },
  outputBlack: { type: RANGE, range: [0, 255], step: 1, default: 0, desc: "Minimum output value (lifts shadows)" },
  outputWhite: { type: RANGE, range: [0, 255], step: 1, default: 255, desc: "Maximum output value (clamps highlights)" },
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

type LevelsOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
};

const levelsFilter = (input: any, options: LevelsOptions = defaults) => {
  const { blackPoint, whitePoint, gamma, outputBlack, outputWhite, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const inputRange = Math.max(1, whitePoint - blackPoint);
  const outputRange = outputWhite - outputBlack;

  if (options._linearize) {
    const inBlack = blackPoint / 255;
    const inWhite = whitePoint / 255;
    const outBlack = outputBlack / 255;
    const outWhite = outputWhite / 255;
    const linearBuf = srgbBufToLinearFloat(buf);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = getBufferIndex(x, y, W);
        for (let c = 0; c < 3; c++) {
          let normalized = (linearBuf[i + c] - inBlack) / Math.max(1e-6, inWhite - inBlack);
          normalized = Math.max(0, Math.min(1, normalized));
          normalized = Math.pow(normalized, 1 / gamma);
          linearBuf[i + c] = Math.max(0, Math.min(1, outBlack + normalized * (outWhite - outBlack)));
        }
        const pixel = [linearBuf[i], linearBuf[i + 1], linearBuf[i + 2], linearBuf[i + 3]];
        const color = linearPaletteGetColor(palette, pixel, palette.options);
        linearBuf[i] = color[0];
        linearBuf[i + 1] = color[1];
        linearBuf[i + 2] = color[2];
      }
    }

    linearFloatToSrgbBuf(linearBuf, outBuf);
  } else {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let normalized = (i - blackPoint) / inputRange;
      normalized = Math.max(0, Math.min(1, normalized));
      normalized = Math.pow(normalized, 1 / gamma);
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
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter<LevelsOptions>({
  name: "Levels",
  func: levelsFilter,
  optionTypes,
  options: defaults,
  defaults
});
