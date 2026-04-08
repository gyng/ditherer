import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  cells: { type: RANGE, range: [5, 500], step: 1, default: 80 },
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

  // Assign each pixel to nearest seed and accumulate color sums
  const sums = seeds.map(() => ({ r: 0, g: 0, b: 0, a: 0, count: 0 }));
  const assignment = new Int32Array(W * H);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      let minDist = Infinity;
      let closestSeed = 0;
      for (let s = 0; s < cells; s += 1) {
        const dx = seeds[s].x - x;
        const dy = seeds[s].y - y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          closestSeed = s;
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

  // Fill each pixel with its cell's average color, optionally quantized
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const s = assignment[y * W + x];
      const col = paletteGetColor(palette, avgColors[s], palette.options, options._linearize);
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
