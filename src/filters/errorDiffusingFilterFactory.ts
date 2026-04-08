import {
  cloneCanvas,
  fillBufferPixel,
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

    const useLinear = options._linearize;
    // errBuf: Float32Array for both paths — avoids boxed JS Array GC pressure.
    // Linear path: values 0.0–1.0. sRGB path: values 0–255 (float for error accumulation).
    const linearBuf = useLinear ? srgbBufToLinearFloat(buf) : null;
    const errBuf = useLinear
      ? new Float32Array(linearBuf!)
      : new Float32Array(buf);

    const kernelWidth = errorMatrix.kernel[0].length;
    const kernelHeight = errorMatrix.kernel.length;
    const offsetX = errorMatrix.offset[0];
    const offsetY = errorMatrix.offset[1];
    const W = output.width;

    // Module-level scratch to avoid per-pixel array allocations in palette call
    const _pix = new Float32Array(4);

    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (x + W * y) * 4;

        if (useLinear) {
          // Read pixel as scalars
          _pix[0] = errBuf[i]; _pix[1] = errBuf[i + 1];
          _pix[2] = errBuf[i + 2]; _pix[3] = errBuf[i + 3];
          const color = paletteGetColor(palette, _pix as any, palette.options, true);
          // Error as scalars — no array alloc
          const er = _pix[0] - color[0];
          const eg = _pix[1] - color[1];
          const eb = _pix[2] - color[2];

          linearBuf![i]     = color[0];
          linearBuf![i + 1] = color[1];
          linearBuf![i + 2] = color[2];

          for (let h = 0; h < kernelHeight; h += 1) {
            for (let w = 0; w < kernelWidth; w += 1) {
              const weight = errorMatrix.kernel[h][w];
              if (weight != null) {
                const ti = ((x + w + offsetX) + W * (y + h + offsetY)) * 4;
                errBuf[ti]     += er * weight;
                errBuf[ti + 1] += eg * weight;
                errBuf[ti + 2] += eb * weight;
              }
            }
          }
        } else {
          // sRGB path — scalars, no rgba()/sub()/scale() allocations
          const pr = errBuf[i], pg = errBuf[i + 1], pb = errBuf[i + 2];
          _pix[0] = pr; _pix[1] = pg; _pix[2] = pb; _pix[3] = errBuf[i + 3];
          const color = palette.getColor(_pix as any, palette.options);
          fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
          const er = pr - color[0];
          const eg = pg - color[1];
          const eb = pb - color[2];

          for (let h = 0; h < kernelHeight; h += 1) {
            for (let w = 0; w < kernelWidth; w += 1) {
              const weight = errorMatrix.kernel[h][w];
              if (weight != null) {
                const ti = ((x + w + offsetX) + W * (y + h + offsetY)) * 4;
                errBuf[ti]     += er * weight;
                errBuf[ti + 1] += eg * weight;
                errBuf[ti + 2] += eb * weight;
              }
            }
          }
        }
      }
    }

    if (useLinear) {
      linearFloatToSrgbBuf(linearBuf!, buf);
    }
    outputCtx.putImageData(new ImageData(buf, W, output.height), 0, 0);
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
