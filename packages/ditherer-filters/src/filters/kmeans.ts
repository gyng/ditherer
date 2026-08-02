import { ENUM, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  laba2rgba,
  rgba2laba,
  srgbPaletteGetColor,
} from "../utils/index";
import { defineFilter } from "./types";

export const COLOR_SPACE = {
  LAB: "LAB",
  RGB: "RGB",
} as const;

export const optionTypes = {
  k: { type: RANGE, range: [2, 32], step: 1, default: 8, desc: "Number of color clusters" },
  iterations: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 10,
    desc: "Clustering iterations for convergence",
  },
  sampleRate: {
    type: RANGE,
    range: [1, 20],
    step: 1,
    default: 4,
    desc: "Sample every Nth pixel for speed",
  },
  colorSpace: {
    type: ENUM,
    options: [
      { name: "Perceptual CIE Lab", value: COLOR_SPACE.LAB },
      { name: "Legacy RGB", value: COLOR_SPACE.RGB },
    ],
    default: COLOR_SPACE.LAB,
    desc: "Space used for centroid averaging and nearest-cluster distance",
  },
  seed: {
    type: RANGE,
    range: [0, 9999],
    step: 1,
    default: 2718,
    desc: "Deterministic k-means++ initialization seed",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  k: optionTypes.k.default,
  iterations: optionTypes.iterations.default,
  sampleRate: optionTypes.sampleRate.default,
  colorSpace: optionTypes.colorSpace.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type ColorPoint = [number, number, number];
type WeightedSample = { color: ColorPoint; weight: number };

const distSq = (a: ColorPoint, b: ColorPoint) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const nearestCentroid = (pixel: ColorPoint, centroids: readonly ColorPoint[]): number => {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centroids.length; c += 1) {
    const d = distSq(pixel, centroids[c]);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
};

const mulberry32 = (seed: number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const weightedIndex = (weights: readonly number[], random: () => number): number => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > Number.EPSILON)) return -1;
  let target = random() * total;
  let lastPositive = -1;
  for (let index = 0; index < weights.length; index += 1) {
    if (weights[index] <= 0) continue;
    lastPositive = index;
    target -= weights[index];
    if (target <= 0) return index;
  }
  return lastPositive;
};

const toWorkingColor = (r: number, g: number, b: number, colorSpace: string): ColorPoint => {
  if (colorSpace === COLOR_SPACE.RGB) return [r, g, b];
  const lab = rgba2laba([r, g, b, 255]);
  return [lab[0], lab[1], lab[2]];
};

const toSrgbColor = (color: ColorPoint, colorSpace: string): ColorPoint => {
  if (colorSpace === COLOR_SPACE.RGB) {
    return [Math.round(color[0]), Math.round(color[1]), Math.round(color[2])];
  }
  const rgb = laba2rgba([color[0], color[1], color[2], 255]);
  return [rgb[0], rgb[1], rgb[2]];
};

const kmeans = (input: any, options: Partial<typeof defaults> = defaults) => {
  const requestedK = Number.isFinite(options.k) ? Math.round(Number(options.k)) : defaults.k;
  const iterations = Number.isFinite(options.iterations)
    ? Math.max(1, Math.min(30, Math.round(Number(options.iterations))))
    : defaults.iterations;
  const sampleRate = Number.isFinite(options.sampleRate)
    ? Math.max(1, Math.min(20, Math.round(Number(options.sampleRate))))
    : defaults.sampleRate;
  const colorSpace =
    String(options.colorSpace) === COLOR_SPACE.RGB ? COLOR_SPACE.RGB : COLOR_SPACE.LAB;
  const seed = Number.isFinite(options.seed) ? Math.round(Number(options.seed)) : defaults.seed;
  const palette = options.palette ?? defaults.palette;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  if (W < 1 || H < 1) return output;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Weight samples by coverage so invisible RGB cannot steer the palette.
  const samples: WeightedSample[] = [];
  for (let y = 0; y < H; y += sampleRate) {
    for (let x = 0; x < W; x += sampleRate) {
      const i = getBufferIndex(x, y, W);
      const weight = buf[i + 3] / 255;
      if (weight <= 0) continue;
      samples.push({
        color: toWorkingColor(buf[i], buf[i + 1], buf[i + 2], colorSpace),
        weight,
      });
    }
  }

  // A coarse sample grid can land entirely on transparent pixels while visible
  // pixels exist between its taps. Seed from the first visible pixel in that
  // degenerate case instead of turning a non-empty image into a no-op.
  if (samples.length === 0) {
    for (let offset = 0; offset < buf.length; offset += 4) {
      const weight = buf[offset + 3] / 255;
      if (weight <= 0) continue;
      samples.push({
        color: toWorkingColor(buf[offset], buf[offset + 1], buf[offset + 2], colorSpace),
        weight,
      });
      break;
    }
    if (samples.length === 0) {
      outputCtx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
      return output;
    }
  }

  // Deterministic, alpha-weighted k-means++ initialization. Stop when every
  // visible sample is already represented instead of adding duplicate dead
  // centroids to uniform or tiny inputs.
  const random = mulberry32(seed);
  const centroids: ColorPoint[] = [];
  const first = weightedIndex(
    samples.map((sample) => sample.weight),
    random,
  );
  centroids.push([...samples[Math.max(0, first)].color]);
  const maximumClusters = Math.max(1, Math.min(32, requestedK, samples.length));
  while (centroids.length < maximumClusters) {
    const dists = samples.map((s) => {
      let minD = Infinity;
      for (const c of centroids) {
        const distance = distSq(s.color, c);
        if (distance < minD) minD = distance;
      }
      return minD * s.weight;
    });
    const chosen = weightedIndex(dists, random);
    if (chosen < 0) break;
    centroids.push([...samples[chosen].color]);
  }

  // Lloyd's algorithm
  for (let iter = 0; iter < iterations; iter += 1) {
    const sums: ColorPoint[] = Array.from({ length: centroids.length }, () => [0, 0, 0]);
    const weights = new Array<number>(centroids.length).fill(0);
    for (const s of samples) {
      const c = nearestCentroid(s.color, centroids);
      sums[c][0] += s.color[0] * s.weight;
      sums[c][1] += s.color[1] * s.weight;
      sums[c][2] += s.color[2] * s.weight;
      weights[c] += s.weight;
    }
    let moved = false;
    for (let c = 0; c < centroids.length; c += 1) {
      if (weights[c] > 0) {
        const next: ColorPoint = [
          sums[c][0] / weights[c],
          sums[c][1] / weights[c],
          sums[c][2] / weights[c],
        ];
        if (distSq(next, centroids[c]) > 1e-12) moved = true;
        centroids[c] = next;
      }
    }
    if (!moved) break;
  }

  const centroidRgb = centroids.map((centroid) => toSrgbColor(centroid, colorSpace));
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      if (buf[i + 3] === 0) {
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], 0);
        continue;
      }
      const pixel = toWorkingColor(buf[i], buf[i + 1], buf[i + 2], colorSpace);
      const c = nearestCentroid(pixel, centroids);
      const rgb = centroidRgb[c];
      const col = srgbPaletteGetColor(
        palette,
        [rgb[0], rgb[1], rgb[2], buf[i + 3]],
        palette.options,
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "K-means",
  func: kmeans,
  options: defaults,
  optionTypes,
  defaults,
  description: "Seeded alpha-aware k-means color clustering in perceptual Lab or legacy RGB space",
  noGL: "Iterative centroid refinement with scatter-gather over a global k-centroid array — no straightforward fragment-shader mapping without atomics.",
});
