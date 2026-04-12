import { ACTION, RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Intensity of the grain noise overlay" },
  size: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Grain particle size in pixels" },
  monochrome: { type: BOOL, default: true, desc: "Use uniform grayscale noise instead of color noise" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amount: optionTypes.amount.default,
  size: optionTypes.size.default,
  monochrome: optionTypes.monochrome.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const filmGrain = (input: any, options = defaults) => {
  const { amount, size, monochrome, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Use block coordinates for grain size > 1
      const bx = Math.floor(x / size);
      const by = Math.floor(y / size);

      // Deterministic per-block noise
      const blockSeed = bx * 31 + by * 997 + frameIndex * 7919;
      const blockRng = mulberry32(blockSeed);

      let nr: number, ng: number, nb: number;
      if (monochrome) {
        const n = (blockRng() - 0.5) * 2 * amount * 255;
        nr = n; ng = n; nb = n;
      } else {
        nr = (blockRng() - 0.5) * 2 * amount * 255;
        ng = (blockRng() - 0.5) * 2 * amount * 255;
        nb = (blockRng() - 0.5) * 2 * amount * 255;
      }

      const r = Math.max(0, Math.min(255, Math.round(buf[i] + nr)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] + ng)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] + nb)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Film Grain",
  func: filmGrain,
  optionTypes,
  options: defaults,
  defaults
});
