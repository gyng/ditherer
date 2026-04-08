import { ENUM, RANGE } from "constants/controlTypes";

import {
  cloneCanvas,
  fillBufferPixel,
  scaleMatrix,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf
} from "utils";

export const SHARPEN_3X3 = "SHARPEN_3X3";
export const UNSHARP_5X5 = "UNSHARP_5X5";
export const GAUSSIAN_3X3 = "GAUSSIAN_3X3";
export const GAUSSIAN_3X3_WEAK = "GAUSSIAN_3X3_WEAK";
export const GAUSSIAN_5X5 = "GAUSSIAN_5X5";
export const EMBOSS_3X3 = "EMBOSS_3X3";
export const LAPLACIAN_3X3 = "LAPLACIAN_3X3";
export const LAPLACIAN_5X5 = "LAPLACIAN_5X5";
export const BRIGHTEN_0_5X = "BRIGHTEN_0_5X";
export const BRIGHTEN_2X = "BRIGHTEN_2X";
export const SOBEL_HORIZONTAL = "SOBEL_HORIZONTAL";
export const SOBEL_VERTICAL = "SOBEL_VERTICAL";
export const OUTLINE_3X3 = "OUTLINE_3X3";

// https://en.wikipedia.org/wiki/Kernel_(image_processing)
// map[y][x]
export const kernels = {
  [SHARPEN_3X3]: {
    width: 3,
    matrix: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]]
  },
  [UNSHARP_5X5]: {
    width: 5,
    matrix: scaleMatrix(
      [
        [1, 4, 6, 4, 1],
        [4, 16, 24, 16, 4],
        [6, 24, -476, 24, 6],
        [4, 16, 24, 16, 4],
        [1, 4, 6, 4, 1]
      ],
      -1 / 256
    )
  },
  [GAUSSIAN_3X3]: {
    width: 3,
    matrix: scaleMatrix([[1, 2, 1], [2, 4, 2], [1, 2, 1]], 1 / 16)
  },
  [GAUSSIAN_3X3_WEAK]: {
    width: 3,
    matrix: scaleMatrix([[0.5, 1, 0.5], [1, 10, 1], [0.5, 1, 0.5]], 1 / 16)
  },
  [GAUSSIAN_5X5]: {
    width: 5,
    matrix: scaleMatrix(
      [
        [1, 4, 6, 4, 1],
        [4, 16, 24, 16, 4],
        [6, 24, 36, 24, 6],
        [4, 16, 24, 16, 4],
        [1, 4, 6, 4, 1]
      ],
      1 / 256
    )
  },
  [BRIGHTEN_2X]: {
    width: 1,
    matrix: [[2]]
  },
  [BRIGHTEN_0_5X]: {
    width: 1,
    matrix: [[0.5]]
  },
  [EMBOSS_3X3]: {
    width: 3,
    matrix: [[-2, -1, 0], [-1, 1, 1], [0, 1, 2]]
  },
  [LAPLACIAN_3X3]: {
    width: 3,
    matrix: [[1, 1, 1], [1, -8, 1], [1, 1, 1]]
  },
  [LAPLACIAN_5X5]: {
    width: 5,
    matrix: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, -24, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1]
    ]
  },
  [SOBEL_HORIZONTAL]: {
    width: 3,
    matrix: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]
  },
  [SOBEL_VERTICAL]: {
    width: 3,
    matrix: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
  },
  [OUTLINE_3X3]: {
    width: 3,
    matrix: [[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]]
  }
};

export const optionTypes = {
  kernel: {
    type: ENUM,
    options: [
      {
        name: "Sharpen",
        value: SHARPEN_3X3
      },
      {
        name: "Unsharp mask 5×5",
        value: UNSHARP_5X5
      },
      {
        name: "Brighten 0.5x",
        value: BRIGHTEN_0_5X
      },
      {
        name: "Brighten 2x",
        value: BRIGHTEN_2X
      },
      {
        name: "Edge detection (Laplacian 3×3)",
        value: LAPLACIAN_3X3
      },
      {
        name: "Edge detection (Laplacian 5×5)",
        value: LAPLACIAN_5X5
      },
      {
        name: "Sobel (horizontal)",
        value: SOBEL_HORIZONTAL
      },
      {
        name: "Sobel (vertical)",
        value: SOBEL_VERTICAL
      },
      {
        name: "Gaussian blur 3×3",
        value: GAUSSIAN_3X3
      },
      {
        name: "Gaussian blur 3×3 (weak)",
        value: GAUSSIAN_3X3_WEAK
      },
      {
        name: "Gaussian blur 5×5",
        value: GAUSSIAN_5X5
      },
      {
        name: "Emboss 3×3",
        value: EMBOSS_3X3
      },
      {
        name: "Outline",
        value: OUTLINE_3X3
      }
    ],
    default: GAUSSIAN_3X3
  },
  strength: {
    type: RANGE,
    range: [-10, 10],
    step: 0.1,
    default: 1
  }
};

export const defaults = {
  kernel: optionTypes.kernel.default,
  strength: optionTypes.strength.default
};

const convolve = (
  input,
  options = defaults
) => {
  const kernel = kernels[options.kernel];
  const matrix = scaleMatrix(kernel.matrix, options.strength);
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const W = input.width;
  const half = Math.floor(kernel.width / 2);

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    const outFloat = new Float32Array(floatBuf.length);

    for (let y = 0; y < input.height; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let cr = 0, cg = 0, cb = 0;

        for (let ky = 0; ky < kernel.width; ky += 1) {
          for (let kx = 0; kx < kernel.width; kx += 1) {
            const kfactor = matrix[ky][kx] || 0;
            if (kfactor === 0) continue;
            const ki = (Math.max(0, x + kx - half) + W * Math.max(0, y + ky - half)) * 4;
            cr += (floatBuf[ki]     || 0) * kfactor;
            cg += (floatBuf[ki + 1] || 0) * kfactor;
            cb += (floatBuf[ki + 2] || 0) * kfactor;
          }
        }

        const i = (x + W * y) * 4;
        fillBufferPixel(outFloat, i, cr, cg, cb, floatBuf[i + 3]);
      }
    }

    const outputBuf = new Uint8ClampedArray(buf.length);
    linearFloatToSrgbBuf(outFloat, outputBuf);
    outputCtx.putImageData(new ImageData(outputBuf, output.width, output.height), 0, 0);
  } else {
    const outBuf = new Uint8ClampedArray(buf.length);

    for (let y = 0; y < input.height; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let cr = 0, cg = 0, cb = 0;

        for (let ky = 0; ky < kernel.width; ky += 1) {
          for (let kx = 0; kx < kernel.width; kx += 1) {
            const kfactor = matrix[ky][kx] || 0;
            if (kfactor === 0) continue;
            const ki = (Math.max(0, x + kx - half) + W * Math.max(0, y + ky - half)) * 4;
            cr += (buf[ki]     || 0) * kfactor;
            cg += (buf[ki + 1] || 0) * kfactor;
            cb += (buf[ki + 2] || 0) * kfactor;
          }
        }

        const i = (x + W * y) * 4;
        fillBufferPixel(outBuf, i, cr, cg, cb, buf[i + 3]);
      }
    }

    outputCtx.putImageData(new ImageData(outBuf, output.width, output.height), 0, 0);
  }
  return output;
};

export default {
  name: "Convolve",
  func: convolve,
  options: defaults,
  optionTypes,
  defaults
};
