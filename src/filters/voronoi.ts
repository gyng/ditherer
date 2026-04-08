import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  cells: { type: RANGE, range: [5, 2000], step: 1, default: 80 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cells: optionTypes.cells.default,
  palette: optionTypes.palette.default
};

const voronoi = (input, options = defaults) => {
  const { cells, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Generate random seed points
  const seeds = Array.from({ length: cells }, () => ({
    x: Math.random() * W,
    y: Math.random() * H
  }));

  // Spatial grid acceleration: divide image into sqrt(cells) x sqrt(cells) buckets
  const gridDim = Math.max(1, Math.ceil(Math.sqrt(cells)));
  const cellW = W / gridDim;
  const cellH = H / gridDim;
  const grid: number[][] = Array.from({ length: gridDim * gridDim }, () => []);
  for (let s = 0; s < cells; s += 1) {
    const gx = Math.min(gridDim - 1, Math.floor(seeds[s].x / cellW));
    const gy = Math.min(gridDim - 1, Math.floor(seeds[s].y / cellH));
    grid[gy * gridDim + gx].push(s);
  }

  // Assign each pixel to nearest seed and accumulate color sums
  const sums = seeds.map(() => ({ r: 0, g: 0, b: 0, a: 0, count: 0 }));
  const assignment = new Int32Array(W * H);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const gx = Math.min(gridDim - 1, Math.floor(x / cellW));
      const gy = Math.min(gridDim - 1, Math.floor(y / cellH));

      let minDist = Infinity;
      let closestSeed = 0;

      // Check ±1 grid cells; expand to ±2 if no seeds found in neighborhood
      for (let radius = 1; radius <= 2; radius += 1) {
        for (let dgy = -radius; dgy <= radius; dgy += 1) {
          for (let dgx = -radius; dgx <= radius; dgx += 1) {
            // Only check the border of the current radius ring (skip inner cells already checked)
            if (radius === 2 && Math.abs(dgx) < 2 && Math.abs(dgy) < 2) continue;
            const ngx = gx + dgx;
            const ngy = gy + dgy;
            if (ngx < 0 || ngx >= gridDim || ngy < 0 || ngy >= gridDim) continue;
            for (const s of grid[ngy * gridDim + ngx]) {
              const dx = seeds[s].x - x;
              const dy = seeds[s].y - y;
              const dist = dx * dx + dy * dy;
              if (dist < minDist) { minDist = dist; closestSeed = s; }
            }
          }
        }
        // Stop expanding once we've found at least one candidate
        if (minDist < Infinity) break;
      }

      // Fallback: full search (rare, only if grid neighborhood was entirely empty)
      if (minDist === Infinity) {
        for (let s = 0; s < cells; s += 1) {
          const dx = seeds[s].x - x;
          const dy = seeds[s].y - y;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) { minDist = dist; closestSeed = s; }
        }
      }

      assignment[y * W + x] = closestSeed;
      const i = getBufferIndex(x, y, W);
      sums[closestSeed].r += buf[i];
      sums[closestSeed].g += buf[i + 1];
      sums[closestSeed].b += buf[i + 2];
      sums[closestSeed].a += buf[i + 3];
      sums[closestSeed].count += 1;
    }
  }

  // Compute average color per cell
  const avgColors = sums.map(s => {
    const n = s.count || 1;
    return rgba(
      Math.round(s.r / n),
      Math.round(s.g / n),
      Math.round(s.b / n),
      Math.round(s.a / n)
    );
  });

  // Fill output
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const s = assignment[y * W + x];
      const col = paletteGetColor(palette, avgColors[s], palette.options, false);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Voronoi",
  func: voronoi,
  options: defaults,
  optionTypes,
  defaults
};
