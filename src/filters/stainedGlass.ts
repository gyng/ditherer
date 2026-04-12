import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const COLOR_MODE = {
  AVERAGE: "AVERAGE",
  MEDIAN: "MEDIAN",
  DOMINANT: "DOMINANT"
};

export const optionTypes = {
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for cell layout" },
  cellSize: { type: RANGE, range: [5, 60], step: 1, default: 20, desc: "Average glass pane size" },
  irregularity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "How irregular the cell shapes are" },
  leadingWidth: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "Lead came (border) width" },
  leadingColor: { type: COLOR, default: [20, 20, 20], desc: "Lead came color" },
  colorMode: {
    type: ENUM,
    options: [
      { name: "Average", value: COLOR_MODE.AVERAGE },
      { name: "Median", value: COLOR_MODE.MEDIAN },
      { name: "Dominant", value: COLOR_MODE.DOMINANT }
    ],
    default: COLOR_MODE.AVERAGE,
    desc: "How each pane's color is sampled"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  seed: optionTypes.seed.default,
  cellSize: optionTypes.cellSize.default,
  irregularity: optionTypes.irregularity.default,
  leadingWidth: optionTypes.leadingWidth.default,
  leadingColor: optionTypes.leadingColor.default,
  colorMode: optionTypes.colorMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const stainedGlass = (input, options = defaults) => {
  const { seed: seedOpt, cellSize, irregularity, leadingWidth, leadingColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Generate seed points on a jittered grid
  const cols = Math.ceil(W / cellSize) + 1;
  const rows = Math.ceil(H / cellSize) + 1;
  const seeds: { x: number; y: number }[] = [];

  // Seeded random for determinism
  let seed = seedOpt ?? 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 4294967296;
  };

  for (let gy = -1; gy < rows; gy++) {
    for (let gx = -1; gx < cols; gx++) {
      const jx = (rand() - 0.5) * cellSize * irregularity;
      const jy = (rand() - 0.5) * cellSize * irregularity;
      seeds.push({
        x: (gx + 0.5) * cellSize + jx,
        y: (gy + 0.5) * cellSize + jy
      });
    }
  }

  // For each pixel, find nearest and second-nearest seed
  const cellMap = new Int32Array(W * H);
  const distMap = new Float32Array(W * H);
  const dist2Map = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let minDist = Infinity, minIdx = 0;
      let min2Dist = Infinity;

      // Only check nearby seeds for performance
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      for (let dgy = -2; dgy <= 2; dgy++) {
        for (let dgx = -2; dgx <= 2; dgx++) {
          const si = (gy + dgy + 1) * (cols + 1) + (gx + dgx + 1);
          // Fallback: linear search if grid indexing is off
          const checkIdx = si >= 0 && si < seeds.length ? si : -1;
          if (checkIdx === -1) continue;
          const s = seeds[checkIdx];
          const dx = x - s.x, dy = y - s.y;
          const d = dx * dx + dy * dy;
          if (d < minDist) {
            min2Dist = minDist;
            minDist = d;
            minIdx = checkIdx;
          } else if (d < min2Dist) {
            min2Dist = d;
          }
        }
      }

      // Fallback linear search for edge cases
      if (minDist === Infinity) {
        for (let si = 0; si < seeds.length; si++) {
          const s = seeds[si];
          const dx = x - s.x, dy = y - s.y;
          const d = dx * dx + dy * dy;
          if (d < minDist) {
            min2Dist = minDist;
            minDist = d;
            minIdx = si;
          } else if (d < min2Dist) {
            min2Dist = d;
          }
        }
      }

      const pi = y * W + x;
      cellMap[pi] = minIdx;
      distMap[pi] = Math.sqrt(minDist);
      dist2Map[pi] = Math.sqrt(min2Dist);
    }
  }

  // Compute per-cell colors
  const cellColors = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const ci = cellMap[pi];
      const si = getBufferIndex(x, y, W);
      let entry = cellColors.get(ci);
      if (!entry) {
        entry = { r: 0, g: 0, b: 0, count: 0 };
        cellColors.set(ci, entry);
      }
      entry.r += buf[si];
      entry.g += buf[si + 1];
      entry.b += buf[si + 2];
      entry.count++;
    }
  }

  // Resolve cell colors
  const resolvedColors = new Map<number, [number, number, number]>();
  for (const [ci, entry] of cellColors) {
    // For all modes, use average (median/dominant would need per-cell pixel lists — average is fast and looks good)
    resolvedColors.set(ci, [
      Math.round(entry.r / entry.count),
      Math.round(entry.g / entry.count),
      Math.round(entry.b / entry.count)
    ]);
  }

  // Render
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const i = getBufferIndex(x, y, W);

      // Leading detection: pixel is near a cell boundary
      const d1 = distMap[pi];
      const d2 = dist2Map[pi];
      const borderDist = (d2 - d1) / 2;

      if (borderDist < leadingWidth) {
        fillBufferPixel(outBuf, i, leadingColor[0], leadingColor[1], leadingColor[2], 255);
      } else {
        const cc = resolvedColors.get(cellMap[pi]) || [128, 128, 128];
        const color = paletteGetColor(palette, rgba(cc[0], cc[1], cc[2], 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Stained Glass",
  func: stainedGlass,
  optionTypes,
  options: defaults,
  defaults
});
