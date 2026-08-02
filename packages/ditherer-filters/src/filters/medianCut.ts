import { RANGE, ENUM } from "../constants/controlTypes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  laba2rgba,
  logFilterBackend,
  rgba2labaMemo,
} from "../utils/index";
import { defineFilter } from "./types";
import { MAX_PALETTE, medianCutGLAvailable, renderMedianCutGL } from "./medianCutGL";

const ADAPT = {
  MID: "MID",
  AVERAGE: "AVERAGE",
  FIRST: "FIRST",
};

const COLOR_MODE = {
  RGB: "RGB",
  LAB: "LAB",
};

const distSq = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const nearestColor = (pixel: number[], palette: number[][]) => {
  let best = palette[0];
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const d = distSq(pixel, color);
    if (d < bestDist) {
      bestDist = d;
      best = color;
    }
  }
  return best;
};

type AdaptivePixel = {
  rgb: [number, number, number, number];
  space: [number, number, number, number];
  weight: number;
  order: number;
};

type AdaptiveBucket = AdaptivePixel[];

const bucketAxis = (bucket: AdaptiveBucket): { axis: number; range: number } => {
  let bestAxis = 0;
  let bestRange = -1;
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (const pixel of bucket) {
      const value = pixel.space[axis];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const range = max - min;
    if (range > bestRange) {
      bestRange = range;
      bestAxis = axis;
    }
  }
  return { axis: bestAxis, range: Math.max(0, bestRange) };
};

const splitBucket = (bucket: AdaptiveBucket): [AdaptiveBucket, AdaptiveBucket] | null => {
  if (bucket.length < 2) return null;
  const { axis } = bucketAxis(bucket);
  const sorted = [...bucket].sort((a, b) => a.space[axis] - b.space[axis] || a.order - b.order);
  const totalWeight = sorted.reduce((sum, pixel) => sum + pixel.weight, 0);
  let accumulated = 0;
  let splitAt = 1;
  for (let index = 0; index < sorted.length - 1; index++) {
    accumulated += sorted[index].weight;
    splitAt = index + 1;
    if (accumulated >= totalWeight * 0.5) break;
  }
  splitAt = Math.max(1, Math.min(sorted.length - 1, splitAt));
  return [sorted.slice(0, splitAt), sorted.slice(splitAt)];
};

const bucketRepresentative = (
  bucket: AdaptiveBucket,
  adaptMode: string,
  colorMode: string,
): number[] => {
  if (adaptMode === "FIRST") return [...(bucket[0]?.rgb ?? [0, 0, 0, 255])];
  if (adaptMode === "MID") {
    const { axis } = bucketAxis(bucket);
    const sorted = [...bucket].sort((a, b) => a.space[axis] - b.space[axis] || a.order - b.order);
    const totalWeight = sorted.reduce((sum, pixel) => sum + pixel.weight, 0);
    let accumulated = 0;
    for (const pixel of sorted) {
      accumulated += pixel.weight;
      if (accumulated >= totalWeight * 0.5) return [...pixel.rgb];
    }
    return [...(sorted[sorted.length - 1]?.rgb ?? [0, 0, 0, 255])];
  }

  const totalWeight = bucket.reduce((sum, pixel) => sum + pixel.weight, 0);
  const average = [0, 0, 0, 255];
  for (const pixel of bucket) {
    average[0] += pixel.space[0] * pixel.weight;
    average[1] += pixel.space[1] * pixel.weight;
    average[2] += pixel.space[2] * pixel.weight;
  }
  average[0] /= totalWeight;
  average[1] /= totalWeight;
  average[2] /= totalWeight;
  const rgb = colorMode === "LAB" ? laba2rgba(average) : average;
  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), 255];
};

/** Build an adaptive palette with an explicit maximum rather than a power-of-two depth. */
export const buildMedianCutPalette = (
  buf: Uint8ClampedArray | Uint8Array,
  requestedColors: number,
  requestedAdaptMode: string,
  requestedColorMode = "RGB",
): number[][] => {
  const maxColors = Math.max(
    1,
    Math.floor(Number.isFinite(requestedColors) ? requestedColors : defaults.levels),
  );
  const adaptMode =
    requestedAdaptMode === "MID" ||
    requestedAdaptMode === "FIRST" ||
    requestedAdaptMode === "AVERAGE"
      ? requestedAdaptMode
      : defaults.adaptMode;
  const colorMode = requestedColorMode === "LAB" ? "LAB" : "RGB";
  const unique = new Map<string, AdaptivePixel>();
  let order = 0;
  for (let offset = 0; offset + 3 < buf.length; offset += 4) {
    const alpha = buf[offset + 3] ?? 0;
    if (alpha <= 0) continue;
    const rgb: [number, number, number, number] = [
      buf[offset] ?? 0,
      buf[offset + 1] ?? 0,
      buf[offset + 2] ?? 0,
      255,
    ];
    const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    const existing = unique.get(key);
    if (existing) {
      existing.weight += alpha / 255;
      continue;
    }
    const converted = colorMode === "LAB" ? rgba2labaMemo(rgb) : rgb;
    unique.set(key, {
      rgb,
      space: [converted[0] ?? 0, converted[1] ?? 0, converted[2] ?? 0, 255],
      weight: alpha / 255,
      order: order++,
    });
  }
  if (unique.size === 0) return [];

  const buckets: AdaptiveBucket[] = [[...unique.values()]];
  while (buckets.length < maxColors) {
    let candidate = -1;
    let candidateScore = -1;
    for (let index = 0; index < buckets.length; index++) {
      const bucket = buckets[index];
      if (bucket.length < 2) continue;
      const weight = bucket.reduce((sum, pixel) => sum + pixel.weight, 0);
      const score = bucketAxis(bucket).range * weight;
      if (score > candidateScore) {
        candidate = index;
        candidateScore = score;
      }
    }
    if (candidate < 0) break;
    const split = splitBucket(buckets[candidate]);
    if (!split) break;
    buckets.splice(candidate, 1, split[0], split[1]);
  }
  return buckets.map((bucket) => bucketRepresentative(bucket, adaptMode, colorMode));
};

export const optionTypes = {
  levels: {
    type: RANGE,
    range: [2, 32],
    step: 1,
    default: 8,
    desc: "Maximum number of colors retained after median-cut palette generation",
  },
  sampleRate: {
    type: RANGE,
    range: [1, 16],
    step: 1,
    default: 2,
    desc: "Use every Nth source pixel when building the adaptive palette",
  },
  adaptMode: {
    type: ENUM,
    options: [
      { name: "Mid", value: ADAPT.MID },
      { name: "Average", value: ADAPT.AVERAGE },
      { name: "First", value: ADAPT.FIRST },
    ],
    default: ADAPT.MID,
    desc: "How each median-cut bucket is represented in the final palette",
  },
  colorMode: {
    type: ENUM,
    options: [
      { name: "RGB", value: COLOR_MODE.RGB },
      { name: "Lab", value: COLOR_MODE.LAB },
    ],
    default: COLOR_MODE.RGB,
    desc: "Color space used when splitting buckets during palette generation",
  },
};

export const defaults = {
  levels: optionTypes.levels.default,
  sampleRate: optionTypes.sampleRate.default,
  adaptMode: optionTypes.adaptMode.default,
  colorMode: optionTypes.colorMode.default,
};

const medianCutFilter = (input: any, options = defaults) => {
  const normalized = { ...defaults, ...options };
  const levels = Math.max(
    2,
    Math.min(32, Math.round(Number(normalized.levels) || defaults.levels)),
  );
  const sampleRate = Math.max(
    1,
    Math.min(16, Math.round(Number(normalized.sampleRate) || defaults.sampleRate)),
  );
  const adaptMode = normalized.adaptMode;
  const colorMode = normalized.colorMode;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const sampled: number[] = [];
  const step = Math.max(1, Math.round(sampleRate));

  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = getBufferIndex(x, y, W);
      if ((buf[i + 3] ?? 0) > 0) sampled.push(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    }
  }

  const palette = buildMedianCutPalette(
    new Uint8ClampedArray(sampled.length > 0 ? sampled : buf),
    levels,
    adaptMode,
    colorMode,
  );

  if (palette.length === 0) {
    outputCtx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
    return output;
  }

  // GL fast path: build pass ran on CPU (recursive tree partition doesn't
  // port well), but the per-pixel nearest-colour scan dominates on larger
  // canvases and maps cleanly to a fragment shader.
  if (
    medianCutGLAvailable() &&
    (options as { _webglAcceleration?: boolean })._webglAcceleration !== false &&
    palette.length > 0 &&
    palette.length <= MAX_PALETTE
  ) {
    const rendered = renderMedianCutGL(input, W, H, palette);
    if (rendered) {
      logFilterBackend("Median Cut", "WebGL2", `levels=${palette.length}`);
      return rendered;
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = nearestColor([buf[i], buf[i + 1], buf[i + 2]], palette);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Median Cut",
  func: medianCutFilter,
  optionTypes,
  options: defaults,
  defaults,
});
