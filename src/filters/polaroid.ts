import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  warmth: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4 },
  fadedBlacks: { type: RANGE, range: [0, 50], step: 1, default: 20 },
  saturation: { type: RANGE, range: [0, 2], step: 0.05, default: 0.8 },
  grain: { type: RANGE, range: [0, 0.5], step: 0.01, default: 0.08 },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.35 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  warmth: optionTypes.warmth.default,
  fadedBlacks: optionTypes.fadedBlacks.default,
  saturation: optionTypes.saturation.default,
  grain: optionTypes.grain.default,
  vignette: optionTypes.vignette.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Simple seeded pseudo-random for deterministic per-frame noise
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const polaroid = (
  input,
  options = defaults
) => {
  const {
    warmth,
    fadedBlacks,
    saturation,
    grain,
    vignette,
    palette
  } = options;

  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const len = buf.length;

  // Per-frame seeded random for film grain
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // --- Step 1: Soft blur pass (3x3 box blur for Polaroid softness) ---
  const blurred = new Uint8ClampedArray(len);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      let count = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          const ni = getBufferIndex(nx, ny, W);
          rSum += buf[ni];
          gSum += buf[ni + 1];
          bSum += buf[ni + 2];
          aSum += buf[ni + 3];
          count++;
        }
      }
      const i = getBufferIndex(x, y, W);
      blurred[i] = rSum / count;
      blurred[i + 1] = gSum / count;
      blurred[i + 2] = bSum / count;
      blurred[i + 3] = aSum / count;
    }
  }

  // --- Step 2: Vignette, color grading, grain ---
  const cx = W / 2;
  const cy = H / 2;
  const outBuf = new Uint8ClampedArray(len);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      let r = blurred[i];
      let g = blurred[i + 1];
      let b = blurred[i + 2];
      const a = blurred[i + 3];

      // --- Reduced saturation (desaturate toward luminance) ---
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = luma + (r - luma) * saturation;
      g = luma + (g - luma) * saturation;
      b = luma + (b - luma) * saturation;

      // --- Faded blacks: lift shadows so darks become brown/gray ---
      r = r + fadedBlacks * (1 - r / 255);
      g = g + fadedBlacks * (1 - g / 255);
      b = b + fadedBlacks * (1 - b / 255);

      // --- Soft highlights: compress highlights for creamy overexposure ---
      r = 255 * (1 - Math.exp(-r / 200));
      g = 255 * (1 - Math.exp(-g / 200));
      b = 255 * (1 - Math.exp(-b / 200));

      // --- Warm color cast: shift toward amber/yellow ---
      r = r + warmth * 25;
      g = g + warmth * 10;
      b = b - warmth * 20;

      // --- Film grain: per-pixel luminance noise ---
      if (grain > 0) {
        const noise = (rng() - 0.5) * grain * 255;
        r += noise;
        g += noise;
        b += noise;
      }

      // --- Vignette: soft corner darkening ---
      if (vignette > 0) {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const vig = 1 - vignette * dist * dist * 0.5;
        r *= vig;
        g *= vig;
        b *= vig;
      }

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Polaroid",
  func: polaroid,
  options: defaults,
  optionTypes,
  defaults
};
