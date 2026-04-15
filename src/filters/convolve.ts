import { ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";

import {
  cloneCanvas,
  fillBufferPixel,
  scaleMatrix,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  logFilterBackend,
} from "utils";
import { convolveGLAvailable, renderConvolveGL } from "./convolveGL";

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
    matrix: scaleMatrix([[1, 2, 1], [2, 4, 2], [1, 2, 1]], 1 / 16),
    separable: { row: [1/4, 2/4, 1/4], col: [1/4, 2/4, 1/4] },
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
    ),
    separable: { row: [1/16, 4/16, 6/16, 4/16, 1/16], col: [1/16, 4/16, 6/16, 4/16, 1/16] },
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
    default: GAUSSIAN_3X3,
    desc: "Convolution kernel — blur, sharpen, edge detect, emboss"
  },
  strength: {
    type: RANGE,
    range: [-10, 10],
    step: 0.1,
    default: 1,
    desc: "Multiplier for the kernel — negative values invert the effect"
  }
};

export const defaults = {
  kernel: optionTypes.kernel.default,
  strength: optionTypes.strength.default
};

type ConvolveOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
};

const convolve = (
  input: any,
  options: ConvolveOptions = defaults
) => {
  const kernel = kernels[String(options.kernel) as keyof typeof kernels];
  const matrix = scaleMatrix(kernel.matrix, options.strength);
  const W = input.width;
  const H = input.height;

  // GL fast path: single-pass 2D convolution. Linearisation is done in-shader
  // via the sRGB transfer function, matching the CPU LUT to within 1 LSB per
  // channel on round-tripped integer inputs.
  if (
    convolveGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const rendered = renderConvolveGL(input, W, H, matrix, kernel.width, !!options._linearize);
    if (rendered) {
      const space = options._linearize ? "linear" : "sRGB";
      logFilterBackend("Convolve", "WebGL2", `${options.kernel} ${kernel.width}x${kernel.width} strength=${options.strength} ${space}`);
      return rendered;
    }
  }

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const half = Math.floor(kernel.width / 2);

  // Separable fast path: two 1D passes instead of one 2D pass.
  // Reduces per-pixel work from K² to 2K multiply-adds.
  const separable = "separable" in kernel ? kernel.separable : undefined;
  if (separable) {
    const row = separable.row.map((v: number) => v * options.strength);
    const col = separable.col;
    const K = row.length;

    // Horizontal 1D pass: src → temp
    const hPass = (src: ArrayLike<number>, temp: Float32Array) => {
      for (let y = 0; y < H; y++) {
        const yOff = W * y;
        // Left border
        for (let x = 0; x < half; x++) {
          let cr = 0, cg = 0, cb = 0;
          for (let k = 0; k < K; k++) {
            const sx = Math.max(0, x + k - half);
            const si = (sx + yOff) * 4;
            cr += (src[si] as number) * row[k]; cg += (src[si + 1] as number) * row[k]; cb += (src[si + 2] as number) * row[k];
          }
          const i = (x + yOff) * 4;
          temp[i] = cr; temp[i + 1] = cg; temp[i + 2] = cb; temp[i + 3] = src[i + 3] as number;
        }
        // Interior — no bounds check
        for (let x = half; x < W - half; x++) {
          let cr = 0, cg = 0, cb = 0;
          for (let k = 0; k < K; k++) {
            const si = (x + k - half + yOff) * 4;
            cr += (src[si] as number) * row[k]; cg += (src[si + 1] as number) * row[k]; cb += (src[si + 2] as number) * row[k];
          }
          const i = (x + yOff) * 4;
          temp[i] = cr; temp[i + 1] = cg; temp[i + 2] = cb; temp[i + 3] = src[i + 3] as number;
        }
        // Right border
        for (let x = Math.max(half, W - half); x < W; x++) {
          let cr = 0, cg = 0, cb = 0;
          for (let k = 0; k < K; k++) {
            const sx = Math.min(W - 1, x + k - half);
            const si = (sx + yOff) * 4;
            cr += (src[si] as number) * row[k]; cg += (src[si + 1] as number) * row[k]; cb += (src[si + 2] as number) * row[k];
          }
          const i = (x + yOff) * 4;
          temp[i] = cr; temp[i + 1] = cg; temp[i + 2] = cb; temp[i + 3] = src[i + 3] as number;
        }
      }
    };

    // Vertical 1D pass: temp → out
    const vPass = (temp: Float32Array, out: Float32Array | Uint8ClampedArray, clamp: boolean) => {
      // Top border
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < W; x++) {
          let cr = 0, cg = 0, cb = 0;
          for (let k = 0; k < K; k++) {
            const sy = Math.max(0, y + k - half);
            const si = (x + W * sy) * 4;
            cr += temp[si] * col[k]; cg += temp[si + 1] * col[k]; cb += temp[si + 2] * col[k];
          }
          const i = (x + W * y) * 4;
          if (clamp) { fillBufferPixel(out, i, cr, cg, cb, temp[i + 3]); }
          else { out[i] = cr; out[i + 1] = cg; out[i + 2] = cb; out[i + 3] = temp[i + 3]; }
        }
      }
      // Interior — no bounds check
      for (let y = half; y < H - half; y++) {
        for (let x = 0; x < W; x++) {
          let cr = 0, cg = 0, cb = 0;
          for (let k = 0; k < K; k++) {
            const si = (x + W * (y + k - half)) * 4;
            cr += temp[si] * col[k]; cg += temp[si + 1] * col[k]; cb += temp[si + 2] * col[k];
          }
          const i = (x + W * y) * 4;
          if (clamp) { fillBufferPixel(out, i, cr, cg, cb, temp[i + 3]); }
          else { out[i] = cr; out[i + 1] = cg; out[i + 2] = cb; out[i + 3] = temp[i + 3]; }
        }
      }
      // Bottom border
      for (let y = Math.max(half, H - half); y < H; y++) {
        for (let x = 0; x < W; x++) {
          let cr = 0, cg = 0, cb = 0;
          for (let k = 0; k < K; k++) {
            const sy = Math.min(H - 1, y + k - half);
            const si = (x + W * sy) * 4;
            cr += temp[si] * col[k]; cg += temp[si + 1] * col[k]; cb += temp[si + 2] * col[k];
          }
          const i = (x + W * y) * 4;
          if (clamp) { fillBufferPixel(out, i, cr, cg, cb, temp[i + 3]); }
          else { out[i] = cr; out[i + 1] = cg; out[i + 2] = cb; out[i + 3] = temp[i + 3]; }
        }
      }
    };

    if (options._linearize) {
      const floatBuf = srgbBufToLinearFloat(buf);
      const temp = new Float32Array(floatBuf.length);
      const outFloat = new Float32Array(floatBuf.length);
      hPass(floatBuf, temp);
      vPass(temp, outFloat, false);
      const outputBuf = new Uint8ClampedArray(buf.length);
      linearFloatToSrgbBuf(outFloat, outputBuf);
      outputCtx.putImageData(new ImageData(outputBuf, W, H), 0, 0);
    } else {
      const temp = new Float32Array(buf.length);
      const outBuf = new Uint8ClampedArray(buf.length);
      hPass(buf, temp);
      vPass(temp, outBuf, true);
      outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    }
    return output;
  }

  // 2D convolution path (non-separable kernels)
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

export default defineFilter<ConvolveOptions>({
  name: "Convolve",
  func: convolve,
  options: defaults,
  optionTypes,
  defaults
});
