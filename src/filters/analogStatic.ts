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
  noiseAmount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5 },
  barHeight: { type: RANGE, range: [1, 100], step: 1, default: 20 },
  barIntensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6 },
  verticalHold: { type: RANGE, range: [0, 50], step: 1, default: 0 },
  ghosting: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3 },
  color: { type: BOOL, default: false },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  noiseAmount: optionTypes.noiseAmount.default,
  barHeight: optionTypes.barHeight.default,
  barIntensity: optionTypes.barIntensity.default,
  verticalHold: optionTypes.verticalHold.default,
  ghosting: optionTypes.ghosting.default,
  color: optionTypes.color.default,
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

const analogStatic = (input, options: any = defaults) => {
  const { noiseAmount, barHeight, barIntensity, verticalHold, ghosting, color: colorNoise, palette } = options;
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

  // Vertical hold: shift entire image
  const vShift = Math.round(verticalHold * Math.sin(frameIndex * 0.3));

  // Generate horizontal noise bars
  const barNoise = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const barY = Math.floor(y / barHeight);
    // Each bar has a consistent brightness
    const barRng = mulberry32(barY * 997 + frameIndex * 31);
    barNoise[y] = (barRng() - 0.5) * 2 * barIntensity;
  }

  for (let y = 0; y < H; y++) {
    const srcY = ((y - vShift) % H + H) % H;

    for (let x = 0; x < W; x++) {
      const si = getBufferIndex(x, srcY, W);
      const di = getBufferIndex(x, y, W);

      // Start with source pixel (with vertical hold shift)
      let r = buf[si];
      let g = buf[si + 1];
      let b = buf[si + 2];

      // Mix with ghosting (previous frame via prevOutput or shifted copy)
      if (ghosting > 0) {
        const ghostX = Math.max(0, Math.min(W - 1, x - 3));
        const gi = getBufferIndex(ghostX, srcY, W);
        r = Math.round(r * (1 - ghosting * 0.5) + buf[gi] * ghosting * 0.5);
        g = Math.round(g * (1 - ghosting * 0.5) + buf[gi] * ghosting * 0.5);
        b = Math.round(b * (1 - ghosting * 0.5) + buf[gi] * ghosting * 0.5);
      }

      // Horizontal bar noise
      const bar = barNoise[y] * 255;
      r = Math.max(0, Math.min(255, Math.round(r + bar)));
      g = Math.max(0, Math.min(255, Math.round(g + bar)));
      b = Math.max(0, Math.min(255, Math.round(b + bar)));

      // Per-pixel static noise
      if (noiseAmount > 0) {
        if (colorNoise) {
          r = Math.max(0, Math.min(255, Math.round(r + (rng() - 0.5) * noiseAmount * 510)));
          g = Math.max(0, Math.min(255, Math.round(g + (rng() - 0.5) * noiseAmount * 510)));
          b = Math.max(0, Math.min(255, Math.round(b + (rng() - 0.5) * noiseAmount * 510)));
        } else {
          const n = (rng() - 0.5) * noiseAmount * 510;
          r = Math.max(0, Math.min(255, Math.round(r + n)));
          g = Math.max(0, Math.min(255, Math.round(g + n)));
          b = Math.max(0, Math.min(255, Math.round(b + n)));
        }
      }

      const c = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, di, c[0], c[1], c[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Analog Static",
  func: analogStatic,
  optionTypes,
  options: defaults,
  defaults
};
