import { RANGE, COLOR, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
} from "../utils/index";
import { stainedGlassGLAvailable, renderStainedGlassGL } from "./stainedGlassGL";
import { resolveStainedGlassCellColors, type StainedGlassColorMode } from "../utils/stainedGlassColor";

export const COLOR_MODE = {
  AVERAGE: "AVERAGE",
  MEDIAN: "MEDIAN",
  DOMINANT: "DOMINANT"
} as const;

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
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
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

const stainedGlass = (input: any, options = defaults) => {
  const normalized = { ...defaults, ...options };
  const seedOpt = Number(normalized.seed) || 0;
  const cellSize = Math.max(1, Math.round(Number(normalized.cellSize) || defaults.cellSize));
  const irregularity = Math.max(0, Math.min(1, Number(normalized.irregularity) || 0));
  const leadingWidth = Math.max(0, Number(normalized.leadingWidth) || 0);
  const leadingColor = Array.isArray(normalized.leadingColor) ? normalized.leadingColor : defaults.leadingColor;
  const requestedColorMode = String(normalized.colorMode);
  const colorMode: StainedGlassColorMode = requestedColorMode === COLOR_MODE.MEDIAN || requestedColorMode === COLOR_MODE.DOMINANT
    ? requestedColorMode
    : COLOR_MODE.AVERAGE;
  const palette = normalized.palette ?? defaults.palette;

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

  // GL fast path. The CPU still builds seed positions (tiny), but the
  // per-pixel Voronoi search + second-nearest distance + final composite
  // run on the GPU. Per-cell colour averages happen on the CPU between the
  // two GL passes (reduction doesn't fit a fragment shader cleanly).
  if (
    stainedGlassGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const gridCols = cols + 1;
    const gridRows = rows + 1;
    if (gridCols * gridRows <= 65536) {
      const rendered = renderStainedGlassGL(
        input, buf, W, H, seeds, gridCols, gridRows, cellSize,
        leadingWidth, leadingColor as [number, number, number], colorMode,
        (r, g, b) => paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false),
      );
      if (rendered) {
        logFilterBackend("Stained Glass", "WebGL2", `cells=${gridCols * gridRows} cellSize=${cellSize}`);
        return rendered;
      }
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

  const resolvedColors = resolveStainedGlassCellColors(cellMap, buf, seeds.length, colorMode);
  for (let offset = 0; offset < resolvedColors.length; offset += 4) {
    if (resolvedColors[offset + 3] === 0) continue;
    const color = paletteGetColor(
      palette,
      rgba(resolvedColors[offset], resolvedColors[offset + 1], resolvedColors[offset + 2], 255),
      palette.options,
      false,
    );
    resolvedColors[offset] = color[0];
    resolvedColors[offset + 1] = color[1];
    resolvedColors[offset + 2] = color[2];
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

      const colorOffset = cellMap[pi] * 4;
      const cc = resolvedColors[colorOffset + 3] > 0
        ? [resolvedColors[colorOffset], resolvedColors[colorOffset + 1], resolvedColors[colorOffset + 2]]
        : [0, 0, 0];
      const rawLeading = Math.max(0, Math.min(1, leadingWidth + 0.5 - borderDist));
      const leading = rawLeading * rawLeading * (3 - 2 * rawLeading);
      fillBufferPixel(
        outBuf,
        i,
        Math.round(cc[0] * (1 - leading) + (leadingColor[0] ?? 0) * leading),
        Math.round(cc[1] * (1 - leading) + (leadingColor[1] ?? 0) * leading),
        Math.round(cc[2] * (1 - leading) + (leadingColor[2] ?? 0) * leading),
        buf[i + 3],
      );
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
