import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  blockCount: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Number of glitch blocks per frame" },
  maxBlockSize: { type: RANGE, range: [10, 200], step: 5, default: 60, desc: "Maximum block dimension in pixels" },
  corruption: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Intensity of color/offset corruption" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 8 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 8); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  blockCount: optionTypes.blockCount.default,
  maxBlockSize: optionTypes.maxBlockSize.default,
  corruption: optionTypes.corruption.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const glitchBlocks = (input: any, options = defaults) => {
  const { blockCount, maxBlockSize, corruption, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  outBuf.set(buf);
  const rng = mulberry32(frameIndex * 7919 + 31337);

  for (let b = 0; b < blockCount; b++) {
    const bw = Math.round(10 + rng() * (maxBlockSize - 10));
    const bh = Math.round(10 + rng() * (maxBlockSize - 10));
    const srcX = Math.floor(rng() * (W - bw));
    const srcY = Math.floor(rng() * (H - bh));
    const dstX = Math.floor(rng() * (W - bw));
    const dstY = Math.floor(rng() * (H - bh));

    // Channel offset for corruption effect
    const chOffX = corruption > 0 ? Math.round((rng() - 0.5) * corruption * 20) : 0;

    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        const sx = srcX + dx, sy = srcY + dy;
        const px = dstX + dx, py = dstY + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;

        const si = getBufferIndex(sx, sy, W);
        const di = getBufferIndex(px, py, W);

        // With corruption: offset R channel
        const rSrcX = Math.max(0, Math.min(W - 1, sx + chOffX));
        const ri = getBufferIndex(rSrcX, sy, W);

        outBuf[di] = buf[ri]; // R from offset
        outBuf[di + 1] = buf[si + 1]; // G from source
        outBuf[di + 2] = buf[si + 2]; // B from source
        outBuf[di + 3] = buf[si + 3];
      }
    }
  }

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Glitch Blocks", func: glitchBlocks, optionTypes, options: defaults, defaults });
