// @flow

import { ENUM } from "constants/controlTypes";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  add,
  scale,
  scaleMatrix
} from "utils";

export const SHARPEN_3X3 = "SHARPEN_3X3";
export const UNSHARP_5X5 = "UNSHARP_5X5";
export const GAUSSIAN_3X3 = "GAUSSIAN_3X3";
export const GAUSSIAN_5X5 = "GAUSSIAN_5X5";
export const EMBOSS_3X3 = "EMBOSS_3X3";
export const LAPLACIAN_3X3 = "LAPLACIAN_3X3";
export const LAPLACIAN_5X5 = "LAPLACIAN_5X5";
export const BRIGHTEN_0_5X = "BRIGHTEN_0_5X";
export const BRIGHTEN_2X = "BRIGHTEN_2X";
export const SOBEL_HORIZONTAL = "SOBEL_HORIZONTAL";
export const SOBEL_VERTICAL = "SOBEL_VERTICAL";
export const OUTLINE_3X3 = "OUTLINE_3X3";

export type Kernel =
  | "BRIGHTEN_0_5X"
  | "BRIGHTEN_2X"
  | "EMBOSS_3X3"
  | "GAUSSIAN_3X3"
  | "GAUSSIAN_5X5"
  | "LAPLACIAN_3X3"
  | "LAPLACIAN_5X5"
  | "OUTLINE_3X3"
  | "SHARPEN_3X3"
  | "SOBEL_HORIZONTAL"
  | "SOBEL_VERTICAL"
  | "UNSHARP_5X5";

// https://en.wikipedia.org/wiki/Kernel_(image_processing)
// map[y][x]
const kernels: {
  [Kernel]: { width: number, matrix: Array<Array<?number>> }
} = {
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
  }
};

const defaults = {
  kernel: optionTypes.kernel.default
};

const convolve = (
  input: HTMLCanvasElement,
  options: {
    kernel: Kernel
  } = defaults
): HTMLCanvasElement => {
  const kernel = kernels[options.kernel];
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const outputArray = Array.from(buf);

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      let color = rgba(0, 0, 0, 0);

      for (let kx = 0; kx < kernel.width; kx += 1) {
        for (let ky = 0; ky < kernel.width; ky += 1) {
          const offset = Math.floor(kernel.width / 2);
          const ki = getBufferIndex(
            Math.max(0, x + kx - offset),
            Math.max(0, y + ky - offset),
            input.width
          );
          const kpx = rgba(
            buf[ki] || 0,
            buf[ki + 1] || 0,
            buf[ki + 2] || 0,
            buf[ki + 3] || 0
          );
          const kfactor = kernel.matrix[ky][kx];

          color = add(color, scale(kpx, kfactor || 0));
        }
      }

      const i = getBufferIndex(x, y, input.width);
      fillBufferPixel(outputArray, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  const outputBuf = new Uint8ClampedArray(outputArray);
  outputCtx.putImageData(
    new ImageData(outputBuf, output.width, output.height),
    0,
    0
  );
  return output;
};

export default {
  name: "Convolve",
  func: convolve,
  options: defaults,
  optionTypes,
  defaults
};
