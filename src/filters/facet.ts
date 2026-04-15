import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmFacetBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
  FACET_FILL_MODE,
} from "utils";
import { paletteIsIdentity } from "palettes/backend";
import { defineFilter } from "filters/types";

const FILL_MODE = {
  AVERAGE: "AVERAGE",
  CENTER: "CENTER"
};

export const optionTypes = {
  facetSize: { type: RANGE, range: [6, 64], step: 1, default: 18, desc: "Average width of each faceted cell" },
  jitter: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Randomize each cell center for a less rigid grid" },
  seamWidth: { type: RANGE, range: [0, 6], step: 1, default: 1, desc: "Dark seam width between facets" },
  lineColor: { type: COLOR, default: [28, 26, 24], desc: "Color of the facet seams" },
  fillMode: {
    type: ENUM,
    options: [
      { name: "Average", value: FILL_MODE.AVERAGE },
      { name: "Center sample", value: FILL_MODE.CENTER }
    ],
    default: FILL_MODE.AVERAGE,
    desc: "How each facet chooses its fill color"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  facetSize: optionTypes.facetSize.default,
  jitter: optionTypes.jitter.default,
  seamWidth: optionTypes.seamWidth.default,
  lineColor: optionTypes.lineColor.default,
  fillMode: optionTypes.fillMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let v = Math.imul(t ^ (t >>> 15), t | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
};

type FacetOptions = typeof defaults & { _wasmAcceleration?: boolean };

const facet = (input: any, options: FacetOptions = defaults) => {
  const { facetSize, jitter, seamWidth, lineColor, fillMode, palette } = options;
  const wasmOk = (options as { _wasmAcceleration?: boolean })._wasmAcceleration !== false;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // WASM fast path: spatial-grid nearest-two lookup + inline nearest
  // palette quantize. Falls through to the JS reference when WASM isn't
  // loaded yet, acceleration is disabled, or the palette isn't `nearest`
  // (the only one the Rust kernel knows how to quantize inline).
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const isNearestPalette = !palette?.name || palette.name === "nearest";
  const canInlinePalette = isNearestPalette && !paletteOpts?.colors;
  const paletteLevels = paletteIsIdentity(palette) ? 256
    : canInlinePalette ? (paletteOpts?.levels ?? 256)
    : -1;
  if (wasmOk && wasmIsLoaded() && paletteLevels >= 0) {
    wasmFacetBuffer(
      buf, outBuf, width, height,
      Math.max(1, Math.round(facetSize)),
      jitter,
      Math.max(0, Math.round(seamWidth)),
      lineColor[0] | 0, lineColor[1] | 0, lineColor[2] | 0,
      fillMode === "CENTER" ? FACET_FILL_MODE.CENTER : FACET_FILL_MODE.AVERAGE,
      paletteLevels,
    );
    logFilterWasmStatus("Facet", true, `size=${facetSize}, fill=${fillMode}`);
    outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
    return output;
  }
  logFilterWasmStatus("Facet", false, !wasmOk ? "_wasmAcceleration off" : !wasmIsLoaded() ? "wasm not loaded yet" : "palette not LUT-able");
  const cols = Math.ceil(width / facetSize) + 2;
  const rows = Math.ceil(height / facetSize) + 2;
  const seeds: { x: number; y: number }[] = [];
  const rng = mulberry32(width * 73856093 ^ height * 19349663 ^ Math.round(jitter * 1000));

  for (let gy = -1; gy < rows - 1; gy += 1) {
    for (let gx = -1; gx < cols - 1; gx += 1) {
      seeds.push({
        x: (gx + 0.5) * facetSize + (rng() - 0.5) * facetSize * jitter,
        y: (gy + 0.5) * facetSize + (rng() - 0.5) * facetSize * jitter
      });
    }
  }

  const assignment = new Int32Array(width * height);
  const nearestDist = new Float32Array(width * height);
  const secondDist = new Float32Array(width * height);
  const sums = seeds.map(() => ({ r: 0, g: 0, b: 0, a: 0, count: 0 }));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = 0;
      let bestDist = Infinity;
      let nextDist = Infinity;

      for (let s = 0; s < seeds.length; s += 1) {
        const dx = x - seeds[s].x;
        const dy = y - seeds[s].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          nextDist = bestDist;
          bestDist = dist;
          best = s;
        } else if (dist < nextDist) {
          nextDist = dist;
        }
      }

      const index = y * width + x;
      assignment[index] = best;
      nearestDist[index] = Math.sqrt(bestDist);
      secondDist[index] = Math.sqrt(nextDist);

      const i = getBufferIndex(x, y, width);
      sums[best].r += buf[i];
      sums[best].g += buf[i + 1];
      sums[best].b += buf[i + 2];
      sums[best].a += buf[i + 3];
      sums[best].count += 1;
    }
  }

  const colors = sums.map((sum, idx) => {
    if (fillMode === FILL_MODE.CENTER) {
      const seed = seeds[idx];
      const sx = Math.max(0, Math.min(width - 1, Math.round(seed.x)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(seed.y)));
      const i = getBufferIndex(sx, sy, width);
      return rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    }
    const count = sum.count || 1;
    return rgba(
      Math.round(sum.r / count),
      Math.round(sum.g / count),
      Math.round(sum.b / count),
      Math.round(sum.a / count)
    );
  });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const i = getBufferIndex(x, y, width);
      const borderDist = (secondDist[index] - nearestDist[index]) * 0.5;

      if (borderDist < seamWidth) {
        fillBufferPixel(outBuf, i, lineColor[0], lineColor[1], lineColor[2], 255);
      } else {
        const color = paletteGetColor(palette, colors[assignment[index]], palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], color[3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Facet",
  func: facet,
  options: defaults,
  optionTypes,
  defaults,
  description: "Break the image into broad faceted planes with regularized seams instead of organic glass cells"
});
