import { ACTION, RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const DRIFT_DIR = { DOWN: "DOWN", UP: "UP", LEFT: "LEFT", RIGHT: "RIGHT" };

export const optionTypes = {
  strength: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "Maximum drift displacement in pixels" },
  direction: {
    type: ENUM,
    options: [
      { name: "Down (gravity)", value: DRIFT_DIR.DOWN },
      { name: "Up (rise)", value: DRIFT_DIR.UP },
      { name: "Left", value: DRIFT_DIR.LEFT },
      { name: "Right", value: DRIFT_DIR.RIGHT }
    ],
    default: DRIFT_DIR.DOWN,
    desc: "Direction pixels drift toward"
  },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance threshold — darker pixels drift more" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 10); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  direction: optionTypes.direction.default,
  threshold: optionTypes.threshold.default,
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

const pixelDrift = (input, options = defaults) => {
  const { strength, direction, threshold, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Copy input to output first
  outBuf.set(buf);

  const rng = mulberry32(frameIndex * 7919 + 31337);
  const isVertical = direction === DRIFT_DIR.DOWN || direction === DRIFT_DIR.UP;
  const isPositive = direction === DRIFT_DIR.DOWN || direction === DRIFT_DIR.RIGHT;

  for (let primary = 0; primary < (isVertical ? W : H); primary++) {
    // Accumulate drift per column/row
    let drift = 0;

    const len = isVertical ? H : W;
    const start = isPositive ? len - 1 : 0;
    const end = isPositive ? -1 : len;
    const step = isPositive ? -1 : 1;

    for (let secondary = start; secondary !== end; secondary += step) {
      const x = isVertical ? primary : secondary;
      const y = isVertical ? secondary : primary;
      const i = getBufferIndex(x, y, W);
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];

      // Darker pixels drift more (heavier)
      if (lum < threshold) {
        drift += (1 - lum / 255) * strength * (0.5 + rng() * 0.5);
      } else {
        drift *= 0.9; // Light pixels slow the drift
      }

      const driftPx = Math.round(drift);
      if (driftPx === 0) continue;

      // Move this pixel along the drift direction
      let destX = x, destY = y;
      if (isVertical) destY = isPositive ? Math.min(H - 1, y + driftPx) : Math.max(0, y - driftPx);
      else destX = isPositive ? Math.min(W - 1, x + driftPx) : Math.max(0, x - driftPx);

      const si = getBufferIndex(x, y, W);
      const di = getBufferIndex(destX, destY, W);

      const color = paletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[si + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Pixel Drift",
  func: pixelDrift,
  optionTypes,
  options: defaults,
  defaults
});
