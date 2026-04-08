import { RANGE } from "constants/controlTypes";
import { cloneCanvas, fillBufferPixel, getBufferIndex } from "utils";

export const optionTypes = {
  iterations: { type: RANGE, range: [1, 100], step: 1, default: 30 },
  feed: { type: RANGE, range: [0, 0.1], step: 0.001, default: 0.055 },
  kill: { type: RANGE, range: [0, 0.1], step: 0.001, default: 0.062 },
  diffusionA: { type: RANGE, range: [0, 1], step: 0.01, default: 1.0 },
  diffusionB: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5 }
};

export const defaults = {
  iterations: optionTypes.iterations.default,
  feed: optionTypes.feed.default,
  kill: optionTypes.kill.default,
  diffusionA: optionTypes.diffusionA.default,
  diffusionB: optionTypes.diffusionB.default
};

const reactionDiffusion = (input, options = defaults) => {
  const { iterations, feed, kill, diffusionA, diffusionB } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Initialize A/B grids from image luminance
  const A = new Float32Array(W * H);
  const B = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const lum = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      A[y * W + x] = 1 - lum;
      B[y * W + x] = lum;
    }
  }

  const nextA = new Float32Array(W * H);
  const nextB = new Float32Array(W * H);

  const laplacian = (grid, x, y) => {
    const c = grid[y * W + x];
    const n = grid[Math.max(0, y - 1) * W + x];
    const s = grid[Math.min(H - 1, y + 1) * W + x];
    const ww = grid[y * W + Math.max(0, x - 1)];
    const e = grid[y * W + Math.min(W - 1, x + 1)];
    return n + s + ww + e - 4 * c;
  };

  // Gray-Scott reaction-diffusion iterations
  for (let iter = 0; iter < iterations; iter += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = y * W + x;
        const a = A[idx];
        const b = B[idx];
        const abb = a * b * b;
        nextA[idx] = Math.max(0, Math.min(1,
          a + diffusionA * laplacian(A, x, y) - abb + feed * (1 - a)
        ));
        nextB[idx] = Math.max(0, Math.min(1,
          b + diffusionB * laplacian(B, x, y) + abb - (kill + feed) * b
        ));
      }
    }
    A.set(nextA);
    B.set(nextB);
  }

  // Render: A-B mapped to value, original hue preserved
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const idx = y * W + x;
      const i = getBufferIndex(x, y, W);
      const v = Math.max(0, Math.min(1, A[idx] - B[idx]));
      fillBufferPixel(
        outBuf, i,
        Math.round(v * buf[i]),
        Math.round(v * buf[i + 1]),
        Math.round(v * buf[i + 2]),
        buf[i + 3]
      );
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Reaction-diffusion",
  func: reactionDiffusion,
  options: defaults,
  optionTypes,
  defaults
};
