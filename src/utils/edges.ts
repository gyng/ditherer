import { getBufferIndex } from "utils";

/** Compute per-pixel luminance from RGBA buffer */
export const computeLuminance = (buf: Uint8ClampedArray, W: number, H: number): Float32Array => {
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }
  return lum;
};

/** Sobel edge detection — returns magnitude and direction per pixel */
export const sobelEdges = (lum: Float32Array, W: number, H: number): {
  magnitude: Float32Array;
  direction: Float32Array;
} => {
  const magnitude = new Float32Array(W * H);
  const direction = new Float32Array(W * H);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const tl = lum[(y - 1) * W + (x - 1)];
      const tc = lum[(y - 1) * W + x];
      const tr = lum[(y - 1) * W + (x + 1)];
      const ml = lum[y * W + (x - 1)];
      const mr = lum[y * W + (x + 1)];
      const bl = lum[(y + 1) * W + (x - 1)];
      const bc = lum[(y + 1) * W + x];
      const br = lum[(y + 1) * W + (x + 1)];

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      magnitude[y * W + x] = Math.sqrt(gx * gx + gy * gy);
      direction[y * W + x] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, direction };
};
