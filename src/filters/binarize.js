import { RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbBufToLinearFloat, linearFloatToSrgbBuf, paletteGetColor } from "utils";

export const optionTypes = {
  thresholdR: { type: RANGE, range: [0, 255], step: 0.5, default: 127.5 },
  thresholdG: { type: RANGE, range: [0, 255], step: 0.5, default: 127.5 },
  thresholdB: { type: RANGE, range: [0, 255], step: 0.5, default: 127.5 },
  thresholdA: { type: RANGE, range: [0, 255], step: 0.5, default: 0 },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  thresholdR: optionTypes.thresholdR.default,
  thresholdG: optionTypes.thresholdG.default,
  thresholdB: optionTypes.thresholdB.default,
  thresholdA: optionTypes.thresholdA.default,
  palette: optionTypes.palette.default
};

const binarize = (
  input,
  options = defaults
) => {
  const getColor = (val, threshold) =>
    val > threshold ? 255 : 0;

  const { thresholdR, thresholdG, thresholdB, thresholdA, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    const getColorF = (val, threshold) =>
      val > threshold / 255 ? 1.0 : 0.0;
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const prePaletteCol = [
          getColorF(floatBuf[i], thresholdR),
          getColorF(floatBuf[i + 1], thresholdG),
          getColorF(floatBuf[i + 2], thresholdB),
          getColorF(floatBuf[i + 3], thresholdA)
        ];
        const col = paletteGetColor(palette, prePaletteCol, palette.options, true);
        fillBufferPixel(floatBuf, i, col[0], col[1], col[2], col[3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const prePaletteCol = rgba(
          getColor(buf[i], thresholdR),
          getColor(buf[i + 1], thresholdG),
          getColor(buf[i + 2], thresholdB),
          getColor(buf[i + 3], thresholdA)
        );
        const col = paletteGetColor(palette, prePaletteCol, palette.options, false);
        fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Binarize",
  func: binarize,
  optionTypes,
  options: defaults,
  defaults
};
