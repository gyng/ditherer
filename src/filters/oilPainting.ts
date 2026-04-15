import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmOilPaintingBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 12], step: 1, default: 4, desc: "Brush stroke radius" },
  levels: { type: RANGE, range: [4, 30], step: 1, default: 20, desc: "Color quantization levels for paint effect" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  levels: optionTypes.levels.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const oilPainting = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean } = defaults) => {
  const { radius, levels, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmOilPaintingBuffer(buf, outBuf, W, H, radius, levels);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
      }
    }
    logFilterWasmStatus("Oil Painting", true, paletteIsIdentity ? `r=${radius}` : `r=${radius}+palettePass`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Oil Painting", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  // Per-bin accumulators (reused per pixel)
  const binCount = new Int32Array(levels);
  const binR = new Float64Array(levels);
  const binG = new Float64Array(levels);
  const binB = new Float64Array(levels);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Clear bins
      binCount.fill(0);
      binR.fill(0);
      binG.fill(0);
      binB.fill(0);

      // Sample neighborhood
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const si = getBufferIndex(nx, ny, W);
          const r = buf[si], g = buf[si + 1], b = buf[si + 2];
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const bin = Math.min(levels - 1, Math.floor(lum * levels));
          binCount[bin]++;
          binR[bin] += r;
          binG[bin] += g;
          binB[bin] += b;
        }
      }

      // Find most populated bin
      let maxBin = 0;
      for (let b = 1; b < levels; b++) {
        if (binCount[b] > binCount[maxBin]) maxBin = b;
      }

      const count = binCount[maxBin];
      const i = getBufferIndex(x, y, W);
      if (count === 0) {
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        continue;
      }

      const r = Math.round(binR[maxBin] / count);
      const g = Math.round(binG[maxBin] / count);
      const b = Math.round(binB[maxBin] / count);

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Oil Painting",
  func: oilPainting,
  optionTypes,
  options: defaults,
  defaults
});
