// @flow

import {
  cloneCanvas,
  fillBufferPixel,
  addBufferPixel,
  getBufferIndex,
  rgba,
  sub,
  scale,
  quantize
} from "./util";

export const makeErrorDiffusingFilter = (
  errorMatrix: {
    offset: [number, number],
    kernel: Array<Array<?number>>
  },
  defaultOptions: { [any]: any }
) => {
  const filter = (
    input: HTMLCanvasElement,
    options: any = defaultOptions
  ): HTMLCanvasElement => {
    const output = cloneCanvas(input, true);
    const outputCtx = output.getContext("2d");
    if (!outputCtx) return input;

    const buf = outputCtx.getImageData(0, 0, input.width, input.height).data;
    if (!buf) return input;
    // Increase precision over u8 (from getImageData) for error diffusion
    const errBuf = Array.from(buf);
    if (!errBuf) return input;

    for (let x = 0; x < output.width; x += 1) {
      for (let y = 0; y < output.height; y += 1) {
        const i: number = getBufferIndex(x, y, output.width);

        // Ignore alpha channel when calculating error
        const pixel = rgba(
          errBuf[i],
          errBuf[i + 1],
          errBuf[i + 2],
          errBuf[i + 3]
        );
        const color = quantize(pixel, options.levels);
        const error = sub(pixel, color);

        // Copy alpha value from input
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

    outputCtx.putImageData(
      new ImageData(buf, output.width, output.height),
      0,
      0
    );
    return output;
  };

  return filter;
};

export default makeErrorDiffusingFilter;
