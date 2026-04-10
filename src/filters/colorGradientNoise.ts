import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

// Simple Perlin-like noise using a hash-based gradient approach
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

const permute = (seed: number): number[] => {
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with seed
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  // Duplicate
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
};

const grad = (hash: number, x: number, y: number): number => {
  const h = hash & 3;
  const u = h < 2 ? x : -x;
  const v = h === 0 || h === 3 ? y : -y;
  return u + v;
};

const perlinNoise = (px: number, py: number, perm: number[]): number => {
  const X = Math.floor(px) & 255;
  const Y = Math.floor(py) & 255;
  const xf = px - Math.floor(px);
  const yf = py - Math.floor(py);
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];
  return (lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v
  ) + 1) / 2; // normalize to 0-1
};

export const optionTypes = {
  scale: { type: RANGE, range: [5, 200], step: 1, default: 50, desc: "Noise feature size in pixels" },
  color1: { type: COLOR, default: [20, 0, 80], desc: "First gradient endpoint color" },
  color2: { type: COLOR, default: [255, 100, 50], desc: "Second gradient endpoint color" },
  mix: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Blend amount with source image" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for noise pattern" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  mix: optionTypes.mix.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const colorGradientNoise = (
  input,
  options = defaults
) => {
  const {
    scale,
    color1,
    color2,
    mix,
    seed,
    palette
  } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const perm = permute(seed);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Perlin noise value at this position
      const noiseVal = perlinNoise(x / scale, y / scale, perm);

      // Lerp between color1 and color2 based on noise
      const nr = lerp(color1[0], color2[0], noiseVal);
      const ng = lerp(color1[1], color2[1], noiseVal);
      const nb = lerp(color1[2], color2[2], noiseVal);

      // Blend with original pixel
      const r = clamp(buf[i] * (1 - mix) + nr * mix);
      const g = clamp(buf[i + 1] * (1 - mix) + ng * mix);
      const b = clamp(buf[i + 2] * (1 - mix) + nb * mix);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default {
  name: "Color Gradient Noise",
  func: colorGradientNoise,
  options: defaults,
  optionTypes,
  defaults
};
