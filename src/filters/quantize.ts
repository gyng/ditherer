import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbBufToLinearFloat, linearFloatToSrgbBuf, srgbPaletteGetColor, linearPaletteGetColor, wasmQuantizeBuffer } from "utils";
import { defineFilter, type FilterOptionValues } from "filters/types";

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

const defaults = {
  palette: { ...optionTypes.palette.default, options: { levels: 7 } }
};

type QuantizePaletteOptions = {
  levels?: number;
  colorDistanceAlgorithm?: string;
  colors?: number[][];
};

type QuantizeOptions = FilterOptionValues & typeof defaults & {
  _wasmAcceleration?: boolean;
  _linearize?: boolean;
  palette?: typeof defaults.palette & {
    options?: QuantizePaletteOptions;
  };
};

const quantize = (
  input: any,
  options: QuantizeOptions = defaults
) => {
  const { palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const algo = palette.options?.colorDistanceAlgorithm;

  // WASM buffer quantize — single call replaces entire pixel loop.
  // Works for sRGB path (no linearize); linear path still needs per-pixel round-trip.
  if (options._wasmAcceleration && !options._linearize && algo && palette.options?.colors) {
    const result = wasmQuantizeBuffer(buf, palette.options.colors, algo);
    if (result) {
      buf.set(result);
      outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
      return output;
    }
  }

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = [floatBuf[i], floatBuf[i + 1], floatBuf[i + 2], floatBuf[i + 3]];
        const color = linearPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(floatBuf, i, color[0], color[1], color[2], floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        const color = srgbPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter<QuantizeOptions>({
  name: "Quantize",
  func: quantize,
  options: defaults,
  optionTypes,
  defaults
});
