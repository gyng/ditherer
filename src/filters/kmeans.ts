import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  k:          { type: RANGE, range: [2, 32], step: 1, default: 8, desc: "Number of color clusters" },
  iterations: { type: RANGE, range: [1, 30], step: 1, default: 10, desc: "Clustering iterations for convergence" },
  sampleRate: { type: RANGE, range: [1, 20], step: 1, default: 4, desc: "Sample every Nth pixel for speed" },
  palette:    { type: PALETTE, default: nearest }
};

export const defaults = {
  k: optionTypes.k.default,
  iterations: optionTypes.iterations.default,
  sampleRate: optionTypes.sampleRate.default,
  palette: optionTypes.palette.default
};

const distSq = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const nearestCentroid = (pixel: number[], centroids: number[][]): number => {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centroids.length; c += 1) {
    const d = distSq(pixel, centroids[c]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
};

const kmeans = (input: any, options = defaults) => {
  const { k, iterations, sampleRate, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Sample pixels for speed
  const step = Math.max(1, Math.round(sampleRate));
  const samples: number[][] = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = getBufferIndex(x, y, W);
      samples.push([buf[i], buf[i + 1], buf[i + 2]]);
    }
  }

  // k-means++ initialization
  const centroids: number[][] = [];
  centroids.push(samples[Math.floor(Math.random() * samples.length)]);
  while (centroids.length < k) {
    const dists = samples.map(s => {
      let minD = Infinity;
      for (const c of centroids) { const d = distSq(s, c); if (d < minD) minD = d; }
      return minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let chosen = 0;
    for (let i = 0; i < dists.length; i += 1) {
      rand -= dists[i];
      if (rand <= 0) { chosen = i; break; }
    }
    centroids.push([...samples[chosen]]);
  }

  // Lloyd's algorithm
  for (let iter = 0; iter < iterations; iter += 1) {
    const sums: number[][] = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (const s of samples) {
      const c = nearestCentroid(s, centroids);
      sums[c][0] += s[0]; sums[c][1] += s[1]; sums[c][2] += s[2];
      counts[c] += 1;
    }
    for (let c = 0; c < k; c += 1) {
      if (counts[c] > 0) {
        centroids[c] = [sums[c][0] / counts[c], sums[c][1] / counts[c], sums[c][2] / counts[c]];
      }
    }
  }

  // Ignore the palette option here — k-means IS the palette; apply nearest centroid per pixel.
  // If palette is set by user it's available but k-means result takes precedence.
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const pixel = [buf[i], buf[i + 1], buf[i + 2]];
      const c = nearestCentroid(pixel, centroids);
      const col = rgba(
        Math.round(centroids[c][0]),
        Math.round(centroids[c][1]),
        Math.round(centroids[c][2]),
        buf[i + 3]
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  // Suppress unused import warning — palette is in optionTypes for UI consistency
  void palette;

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "K-means",
  func: kmeans,
  options: defaults,
  optionTypes,
  defaults
});
