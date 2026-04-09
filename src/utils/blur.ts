import { getBufferIndex } from "utils";

/** Build a 1D Gaussian kernel */
const buildKernel = (sigma: number): { kernel: Float32Array; radius: number } => {
  const radius = Math.ceil(sigma * 3);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return { kernel, radius };
};

/** Separable Gaussian blur on RGBA buffer — returns per-channel Float32Arrays */
export const gaussianBlurRGBA = (
  buf: Uint8ClampedArray, W: number, H: number, sigma: number
): { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array } => {
  const { kernel, radius } = buildKernel(sigma);

  // Horizontal pass
  const tR = new Float32Array(W * H), tG = new Float32Array(W * H);
  const tB = new Float32Array(W * H), tA = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const si = getBufferIndex(nx, y, W);
        const w = kernel[k + radius];
        sr += buf[si] * w; sg += buf[si + 1] * w; sb += buf[si + 2] * w; sa += buf[si + 3] * w;
      }
      const pi = y * W + x;
      tR[pi] = sr; tG[pi] = sg; tB[pi] = sb; tA[pi] = sa;
    }

  // Vertical pass
  const r = new Float32Array(W * H), g = new Float32Array(W * H);
  const b = new Float32Array(W * H), a = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const pi = ny * W + x;
        const w = kernel[k + radius];
        sr += tR[pi] * w; sg += tG[pi] * w; sb += tB[pi] * w; sa += tA[pi] * w;
      }
      const pi = y * W + x;
      r[pi] = sr; g[pi] = sg; b[pi] = sb; a[pi] = sa;
    }

  return { r, g, b, a };
};

/** Separable Gaussian blur on a single-channel Float32Array */
export const gaussianBlur1D = (
  data: Float32Array, W: number, H: number, sigma: number
): Float32Array => {
  const { kernel, radius } = buildKernel(sigma);

  const temp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        s += data[y * W + nx] * kernel[k + radius];
      }
      temp[y * W + x] = s;
    }

  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        s += temp[ny * W + x] * kernel[k + radius];
      }
      out[y * W + x] = s;
    }

  return out;
};
