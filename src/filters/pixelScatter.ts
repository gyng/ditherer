import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";

export const optionTypes = {
  spread: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "Max random scatter distance in pixels" },
  threshold: { type: RANGE, range: [0, 200], step: 1, default: 50, desc: "Edge strength required to trigger scatter" },
  density: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Fraction of edge pixels that scatter" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _filterFunc, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 10); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  spread: optionTypes.spread.default,
  threshold: optionTypes.threshold.default,
  density: optionTypes.density.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const pixelScatter = (input, options = defaults) => {
  const { spread, threshold, density, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Edge detection for scatter source
  const lum = computeLuminance(buf, W, H);
  const { magnitude, direction } = sobelEdges(lum, W, H);

  // Start with original
  outBuf.set(buf);

  // Scatter pixels near edges outward
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const pi = y * W + x;
      const edge = magnitude[pi];

      if (edge < threshold) continue;
      if (rng() > density) continue;

      // Scatter direction: away from edge (along gradient)
      const angle = direction[pi];
      const dist = spread * (edge / 255) * (0.5 + rng() * 0.5);
      const dx = Math.round(Math.cos(angle) * dist);
      const dy = Math.round(Math.sin(angle) * dist);
      const destX = Math.max(0, Math.min(W - 1, x + dx));
      const destY = Math.max(0, Math.min(H - 1, y + dy));

      const si = getBufferIndex(x, y, W);
      const di = getBufferIndex(destX, destY, W);
      const color = paletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[si + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Pixel Scatter", func: pixelScatter, optionTypes, options: defaults, defaults });
