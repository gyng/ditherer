import { ACTION, RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  maxShift: { type: RANGE, range: [0, 200], step: 1, default: 30, desc: "Maximum horizontal shift in pixels" },
  blockHeight: { type: RANGE, range: [1, 50], step: 1, default: 4, desc: "Height of each shifted block" },
  chance: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Probability of shifting each block" },
  colorShift: { type: BOOL, default: true, desc: "Shift RGB channels independently" },
  wrap: { type: BOOL, default: true, desc: "Wrap shifted pixels around edges" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 8 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 8); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  maxShift: optionTypes.maxShift.default,
  blockHeight: optionTypes.blockHeight.default,
  chance: optionTypes.chance.default,
  colorShift: optionTypes.colorShift.default,
  wrap: optionTypes.wrap.default,
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

const scanLineShift = (input, options: any = defaults) => {
  const { maxShift, blockHeight, chance, colorShift, wrap, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  for (let blockY = 0; blockY < H; blockY += blockHeight) {
    const shouldShift = rng() < chance;
    const shift = shouldShift ? Math.round((rng() * 2 - 1) * maxShift) : 0;
    const rShift = (colorShift && shouldShift) ? Math.round((rng() * 2 - 1) * Math.min(maxShift, 10)) : 0;

    for (let dy = 0; dy < blockHeight && blockY + dy < H; dy++) {
      const y = blockY + dy;
      for (let x = 0; x < W; x++) {
        const dstIdx = getBufferIndex(x, y, W);

        let srcX = x - shift;
        let srcXR = x - shift - rShift;

        if (wrap) {
          srcX = ((srcX % W) + W) % W;
          srcXR = ((srcXR % W) + W) % W;
        } else if (srcX < 0 || srcX >= W) {
          fillBufferPixel(outBuf, dstIdx, 0, 0, 0, 255);
          continue;
        }

        const srcIdx = getBufferIndex(srcX, y, W);
        let r = buf[srcIdx];

        if (colorShift && rShift !== 0 && srcXR >= 0 && srcXR < W) {
          r = buf[getBufferIndex(srcXR, y, W)];
        }

        const g = buf[srcIdx + 1];
        const b = buf[srcIdx + 2];
        const a = buf[srcIdx + 3];

        const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
        fillBufferPixel(outBuf, dstIdx, color[0], color[1], color[2], a);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Scan Line Shift",
  func: scanLineShift,
  optionTypes,
  options: defaults,
  defaults
};
