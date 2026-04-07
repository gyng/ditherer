import {
  cloneCanvas,
  fillBufferPixel,
  addBufferPixel,
  getBufferIndex,
  rgba,
  sub,
  scale,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  paletteGetColor
} from "utils";

import { PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";

export const optionTypes = {
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  palette: optionTypes.palette.default
};

export const errorDiffusingFilter = (
  name,
  errorMatrix,
  defaultOptions
) => {
  const filter = (
    input,
    options = defaultOptions
  ) => {
    const { palette } = options;

    const output = cloneCanvas(input, true);
    const outputCtx = output.getContext("2d");
    if (!outputCtx) return input;

    const buf = outputCtx.getImageData(0, 0, input.width, input.height).data;
    if (!buf) return input;

    // When linearized, work in float linear space for full precision.
    // errBuf holds working values (float linear or int sRGB).
    // outBuf accumulates final pixel values.
    const useLinear = options._linearize;
    const linearBuf = useLinear ? srgbBufToLinearFloat(buf) : null;
    const errBuf = useLinear
      ? Array.from(linearBuf)  // float 0-1 precision
      : Array.from(buf);       // int 0-255 precision
    if (!errBuf) return input;

    for (let x = 0; x < output.width; x += 1) {
      for (let y = 0; y < output.height; y += 1) {
        const i = getBufferIndex(x, y, output.width);

        if (useLinear) {
          // Float linear path: pixel values are 0.0-1.0
          const pixel = [errBuf[i], errBuf[i + 1], errBuf[i + 2], errBuf[i + 3]];
          const color = paletteGetColor(palette, pixel, palette.options, true);
          const error = [pixel[0] - color[0], pixel[1] - color[1], pixel[2] - color[2], 0];

          linearBuf[i]     = color[0];
          linearBuf[i + 1] = color[1];
          linearBuf[i + 2] = color[2];
          // keep alpha

          const kernelWidth = errorMatrix.kernel[0].length;
          const kernelHeight = errorMatrix.kernel.length;

          for (let w = 0; w < kernelWidth; w += 1) {
            for (let h = 0; h < kernelHeight; h += 1) {
              const weight = errorMatrix.kernel[h][w];
              if (weight != null) {
                const targetIdx = getBufferIndex(
                  x + w + errorMatrix.offset[0],
                  y + h + errorMatrix.offset[1],
                  output.width
                );
                errBuf[targetIdx]     += error[0] * weight;
                errBuf[targetIdx + 1] += error[1] * weight;
                errBuf[targetIdx + 2] += error[2] * weight;
              }
            }
          }
        } else {
          // Original sRGB int path
          const pixel = rgba(errBuf[i], errBuf[i + 1], errBuf[i + 2], errBuf[i + 3]);
          const color = palette.getColor(pixel, palette.options);
          const error = sub(pixel, color);

          fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);

          const kernelWidth = errorMatrix.kernel[0].length;
          const kernelHeight = errorMatrix.kernel.length;

          for (let w = 0; w < kernelWidth; w += 1) {
            for (let h = 0; h < kernelHeight; h += 1) {
              const weight = errorMatrix.kernel[h][w];
              if (weight != null) {
                const targetIdx = getBufferIndex(
                  x + w + errorMatrix.offset[0],
                  y + h + errorMatrix.offset[1],
                  output.width
                );
                const toDiffuse = scale(error, weight);
                addBufferPixel(errBuf, targetIdx, toDiffuse);
              }
            }
          }
        }
      }
    }

    if (useLinear) {
      linearFloatToSrgbBuf(linearBuf, buf);
    }
    outputCtx.putImageData(
      new ImageData(buf, output.width, output.height),
      0,
      0
    );
    return output;
  };

  return {
    name,
    func: filter,
    optionTypes,
    options: defaults,
    defaults: defaultOptions
  };
};

export default errorDiffusingFilter;
