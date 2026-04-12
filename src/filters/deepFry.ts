import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
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
  contrast:   { type: RANGE, range: [1, 5], step: 0.1, default: 3, desc: "Extreme contrast boost" },
  saturation: { type: RANGE, range: [1, 5], step: 0.1, default: 3, desc: "Extreme saturation boost" },
  blockiness: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "JPEG-like block artifact intensity" },
  noise:      { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Random noise grain amount" },
  sharpness:  { type: RANGE, range: [0, 3], step: 0.05, default: 1.5, desc: "Over-sharpening intensity" },
  warmth:     { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Warm color cast toward orange/red" },
  animSpeed:  { type: RANGE, range: [1, 30], step: 1, default: 8 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 8); }
    }
  },
  palette:    { type: PALETTE, default: nearest }
};

export const defaults = {
  contrast:   optionTypes.contrast.default,
  saturation: optionTypes.saturation.default,
  blockiness: optionTypes.blockiness.default,
  noise:      optionTypes.noise.default,
  sharpness:  optionTypes.sharpness.default,
  warmth:     optionTypes.warmth.default,
  animSpeed:  optionTypes.animSpeed.default,
  palette:    { ...optionTypes.palette.default, options: { levels: 256 } }
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

const clamp = (v: number) => Math.max(0, Math.min(255, v));

// Convert RGB to HSL
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 :
    max === g ? ((b - r) / d + 2) / 6 :
    ((r - g) / d + 4) / 6;
  return [h, s, l];
};

// Convert HSL to RGB
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
};

const deepFry = (input, options = defaults) => {
  const { contrast, saturation, blockiness, noise, sharpness, warmth, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Working buffer as floats for intermediate processing
  const work = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    work[i] = buf[i];
  }

  // --- Pass 1: Extreme contrast (S-curve) ---
  const contrastFactor = contrast * 1.2;
  for (let i = 0; i < work.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = work[i + c] / 255;
      // S-curve: apply sigmoid-like contrast
      v = (v - 0.5) * contrastFactor + 0.5;
      // Additional hard clipping for crushed blacks / blown highlights
      v = v < 0.1 ? v * 0.3 : v;
      v = v > 0.9 ? 1 - (1 - v) * 0.3 : v;
      work[i + c] = clamp(v * 255);
    }
  }

  // --- Pass 2: Oversaturation ---
  for (let i = 0; i < work.length; i += 4) {
    const [h, s, l] = rgbToHsl(work[i], work[i + 1], work[i + 2]);
    const boostedS = Math.min(1, s * saturation);
    const [r, g, b] = hslToRgb(h, boostedS, l);
    work[i] = r;
    work[i + 1] = g;
    work[i + 2] = b;
  }

  // --- Pass 3: Warm/red cast ---
  if (warmth > 0) {
    for (let i = 0; i < work.length; i += 4) {
      work[i]     = clamp(work[i] + warmth * 60);      // boost red
      work[i + 1] = clamp(work[i + 1] + warmth * 20);  // slight green boost (orange)
      work[i + 2] = clamp(work[i + 2] - warmth * 30);  // reduce blue
    }
  }

  // --- Pass 4: JPEG-like blockiness (8x8 block averaging) ---
  if (blockiness > 0) {
    const blockSize = 8;
    for (let by = 0; by < H; by += blockSize) {
      for (let bx = 0; bx < W; bx += blockSize) {
        // Compute block average
        let sumR = 0, sumG = 0, sumB = 0;
        let count = 0;
        const bw = Math.min(blockSize, W - bx);
        const bh = Math.min(blockSize, H - by);
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            const idx = getBufferIndex(bx + dx, by + dy, W);
            sumR += work[idx];
            sumG += work[idx + 1];
            sumB += work[idx + 2];
            count++;
          }
        }
        const avgR = sumR / count;
        const avgG = sumG / count;
        const avgB = sumB / count;

        // Blend original with block average
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            const idx = getBufferIndex(bx + dx, by + dy, W);
            work[idx]     = work[idx]     * (1 - blockiness) + avgR * blockiness;
            work[idx + 1] = work[idx + 1] * (1 - blockiness) + avgG * blockiness;
            work[idx + 2] = work[idx + 2] * (1 - blockiness) + avgB * blockiness;
          }
        }
      }
    }
  }

  // --- Pass 5: Unsharp mask (over-sharpening) ---
  if (sharpness > 0) {
    // Simple 3x3 box blur for the mask
    const blurred = new Float32Array(work.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sr = 0, sg = 0, sb = 0;
        let count = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const ki = getBufferIndex(nx, ny, W);
            sr += work[ki];
            sg += work[ki + 1];
            sb += work[ki + 2];
            count++;
          }
        }
        const i = getBufferIndex(x, y, W);
        blurred[i]     = sr / count;
        blurred[i + 1] = sg / count;
        blurred[i + 2] = sb / count;
        blurred[i + 3] = work[i + 3];
      }
    }

    // Unsharp mask: original + strength * (original - blurred)
    for (let i = 0; i < work.length; i += 4) {
      work[i]     = clamp(work[i]     + sharpness * (work[i]     - blurred[i]));
      work[i + 1] = clamp(work[i + 1] + sharpness * (work[i + 1] - blurred[i + 1]));
      work[i + 2] = clamp(work[i + 2] + sharpness * (work[i + 2] - blurred[i + 2]));
    }
  }

  // --- Pass 6: Noise + palette + write output ---
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      let r = work[i];
      let g = work[i + 1];
      let b = work[i + 2];

      // Add random noise
      if (noise > 0) {
        const n = (rng() - 0.5) * noise * 255;
        r = clamp(r + n);
        g = clamp(g + n);
        b = clamp(b + n);
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Deep fry",
  func: deepFry,
  options: defaults,
  optionTypes,
  defaults
});
