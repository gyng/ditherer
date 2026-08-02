import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
} from "../utils/index";
import { defineFilter } from "./types";

export const optionTypes = {
  cells: { type: RANGE, range: [5, 2000], step: 1, default: 80, desc: "Number of Voronoi cells" },
  seed: {
    type: RANGE,
    range: [0, 9999],
    step: 1,
    default: 1729,
    desc: "Deterministic cell-layout seed",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  cells: optionTypes.cells.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type VoronoiSeed = { x: number; y: number };
type SeedGrid = {
  buckets: number[][];
  cellWidth: number;
  cellHeight: number;
  dimension: number;
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

const createSeedGrid = (seeds: readonly VoronoiSeed[], width: number, height: number): SeedGrid => {
  const dimension = Math.max(1, Math.ceil(Math.sqrt(seeds.length)));
  const cellWidth = Math.max(1, width) / dimension;
  const cellHeight = Math.max(1, height) / dimension;
  const buckets: number[][] = Array.from({ length: dimension * dimension }, () => []);
  for (let index = 0; index < seeds.length; index += 1) {
    const gx = Math.min(dimension - 1, Math.max(0, Math.floor(seeds[index].x / cellWidth)));
    const gy = Math.min(dimension - 1, Math.max(0, Math.floor(seeds[index].y / cellHeight)));
    buckets[gy * dimension + gx].push(index);
  }
  return { buckets, cellWidth, cellHeight, dimension };
};

const nearestSeedFromGrid = (
  x: number,
  y: number,
  seeds: readonly VoronoiSeed[],
  grid: SeedGrid,
): number => {
  const { buckets, cellWidth, cellHeight, dimension } = grid;
  const gx = Math.min(dimension - 1, Math.max(0, Math.floor(x / cellWidth)));
  const gy = Math.min(dimension - 1, Math.max(0, Math.floor(y / cellHeight)));
  let closest = 0;
  let minimumSquared = Number.POSITIVE_INFINITY;

  for (let radius = 0; radius < dimension; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (radius > 0 && Math.abs(offsetX) !== radius && Math.abs(offsetY) !== radius) continue;
        const bucketX = gx + offsetX;
        const bucketY = gy + offsetY;
        if (bucketX < 0 || bucketX >= dimension || bucketY < 0 || bucketY >= dimension) continue;
        for (const seedIndex of buckets[bucketY * dimension + bucketX]) {
          const dx = seeds[seedIndex].x - x;
          const dy = seeds[seedIndex].y - y;
          const squared = dx * dx + dy * dy;
          if (squared < minimumSquared) {
            minimumSquared = squared;
            closest = seedIndex;
          }
        }
      }
    }

    if (minimumSquared === Number.POSITIVE_INFINITY) continue;

    // Every unsearched bucket lies beyond at least one edge of this rectangle.
    // Once the closest such edge is farther than the best site, no later ring
    // can improve the answer. Merely finding a site is not sufficient: a site
    // in a populated inner bucket can still be farther than an outer bucket
    // when the sample lies near a bucket boundary.
    const minBucketX = Math.max(0, gx - radius);
    const maxBucketX = Math.min(dimension - 1, gx + radius);
    const minBucketY = Math.max(0, gy - radius);
    const maxBucketY = Math.min(dimension - 1, gy + radius);
    let minimumOutside = Number.POSITIVE_INFINITY;
    if (minBucketX > 0) minimumOutside = Math.min(minimumOutside, x - minBucketX * cellWidth);
    if (maxBucketX < dimension - 1) {
      minimumOutside = Math.min(minimumOutside, (maxBucketX + 1) * cellWidth - x);
    }
    if (minBucketY > 0) minimumOutside = Math.min(minimumOutside, y - minBucketY * cellHeight);
    if (maxBucketY < dimension - 1) {
      minimumOutside = Math.min(minimumOutside, (maxBucketY + 1) * cellHeight - y);
    }
    if (minimumSquared <= minimumOutside * minimumOutside) break;
  }

  return closest;
};

export const findNearestVoronoiSeed = (
  x: number,
  y: number,
  seeds: readonly VoronoiSeed[],
  width: number,
  height: number,
): number =>
  seeds.length > 0 ? nearestSeedFromGrid(x, y, seeds, createSeedGrid(seeds, width, height)) : -1;

const voronoi = (input: any, options: Partial<typeof defaults> = defaults) => {
  const palette = options.palette ?? defaults.palette;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  if (W < 1 || H < 1) return output;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  const requestedCells = Number.isFinite(options.cells) ? Number(options.cells) : defaults.cells;
  const cells = Math.max(1, Math.min(W * H, Math.round(requestedCells)));
  const seed = Number.isFinite(options.seed) ? Math.round(Number(options.seed)) : defaults.seed;
  const random = mulberry32(seed);
  const seeds = Array.from({ length: cells }, () => ({
    x: random() * W,
    y: random() * H,
  }));
  const grid = createSeedGrid(seeds, W, H);

  // Assign each pixel to nearest seed and accumulate color sums
  const sums = seeds.map(() => ({ r: 0, g: 0, b: 0, a: 0, count: 0 }));
  const assignment = new Int32Array(W * H);

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const closestSeed = nearestSeedFromGrid(x, y, seeds, grid);
      assignment[y * W + x] = closestSeed;
      const i = getBufferIndex(x, y, W);
      const alpha = buf[i + 3] / 255;
      sums[closestSeed].r += buf[i] * alpha;
      sums[closestSeed].g += buf[i + 1] * alpha;
      sums[closestSeed].b += buf[i + 2] * alpha;
      sums[closestSeed].a += buf[i + 3];
      sums[closestSeed].count += 1;
    }
  }

  // Compute average color per cell
  const avgColors = sums.map((s) => {
    const n = s.count || 1;
    const alphaWeight = s.a / 255;
    return rgba(
      alphaWeight > 0 ? Math.round(s.r / alphaWeight) : 0,
      alphaWeight > 0 ? Math.round(s.g / alphaWeight) : 0,
      alphaWeight > 0 ? Math.round(s.b / alphaWeight) : 0,
      Math.round(s.a / n),
    );
  });

  // Fill output
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const s = assignment[y * W + x];
      const col = srgbPaletteGetColor(palette, avgColors[s], palette.options);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Voronoi",
  func: voronoi,
  options: defaults,
  optionTypes,
  defaults,
  description: "Deterministic seeded Voronoi cells filled with alpha-aware average source colors",
  noWASM:
    "Two-pass per-cell colour averaging needs a reduction over all assigned pixels — hard to vectorise without randomised-access atomics and not a win over the existing spatial-grid JS path.",
  noGL: "Per-cell colour averaging is a reduction; WebGL2 fragment shaders can't accumulate into shared per-cell bins without compute shaders or float blend extensions.",
});
