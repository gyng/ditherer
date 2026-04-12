import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  density: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.5, desc: "Overall dot coverage density" },
  dotSize: { type: RANGE, range: [1, 3], step: 1, default: 1, desc: "Individual mezzotint dot size" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  dotSize: optionTypes.dotSize.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const mezzotint = (input: any, options = defaults) => {
  const { density, dotSize, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Fill white
  for (let i = 0; i < outBuf.length; i += 4) { outBuf[i] = 255; outBuf[i + 1] = 255; outBuf[i + 2] = 255; outBuf[i + 3] = 255; }

  // For each block, use seeded random to decide if a dot is placed
  // Probability proportional to local darkness
  for (let y = 0; y < H; y += dotSize) {
    for (let x = 0; x < W; x += dotSize) {
      const si = getBufferIndex(Math.min(W - 1, x), Math.min(H - 1, y), W);
      const lum = (0.2126 * buf[si] + 0.7152 * buf[si + 1] + 0.0722 * buf[si + 2]) / 255;
      const darkness = 1 - lum;

      // Seeded per-position RNG for determinism
      const rng = mulberry32(x * 31 + y * 997 + 42);
      const shouldDot = rng() < darkness * density;

      if (shouldDot) {
        for (let dy = 0; dy < dotSize && y + dy < H; dy++)
          for (let dx = 0; dx < dotSize && x + dx < W; dx++) {
            const di = getBufferIndex(x + dx, y + dy, W);
            const color = paletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], 255), palette.options, false);
            fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
          }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Mezzotint", func: mezzotint, optionTypes, options: defaults, defaults });
