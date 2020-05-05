import { RANGE, PALETTE } from "@src/constants/controlTypes";
import * as palettes from "@src/palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "@src/util";

import type { Palette } from "@src/types";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 4], step: 0.01, default: 0.33 },
  gap: { type: RANGE, range: [0, 255], step: 1, default: 3 },
  height: { type: RANGE, range: [0, 255], step: 1, default: 1 },
  palette: { type: PALETTE, default: palettes.nearest },
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  gap: optionTypes.gap.default,
  height: optionTypes.height.default,
  palette: optionTypes.palette.default,
};

const scanline = (
  input: HTMLCanvasElement,
  options: {
    intensity: number;
    gap: number;
    height: number;
    palette: Palette;
  } = defaults
): HTMLCanvasElement => {
  const { intensity, gap, height, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const scale = y % gap < height ? intensity : 1;

      const prePaletteColor = rgba(
        buf[i] * scale,
        buf[i + 1] * scale,
        buf[i + 2] * scale,
        buf[i + 3]
      );

      const col = palette.getColor(prePaletteColor, palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Scanline",
  func: scanline,
  optionTypes,
  options: defaults,
  defaults,
};
