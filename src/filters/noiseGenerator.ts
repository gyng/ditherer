import { ACTION, RANGE, BOOL, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const NOISE_TYPE = {
  PERLIN: "PERLIN",
  SIMPLEX: "SIMPLEX",
  WORLEY: "WORLEY"
};

export const optionTypes = {
  type: {
    type: ENUM,
    options: [
      { name: "Perlin", value: NOISE_TYPE.PERLIN },
      { name: "Simplex", value: NOISE_TYPE.SIMPLEX },
      { name: "Worley", value: NOISE_TYPE.WORLEY }
    ],
    default: NOISE_TYPE.PERLIN
  },
  scale: { type: RANGE, range: [1, 200], step: 1, default: 50 },
  octaves: { type: RANGE, range: [1, 8], step: 1, default: 4 },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42 },
  colorize: { type: BOOL, default: false },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5 },
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
  type: optionTypes.type.default,
  scale: optionTypes.scale.default,
  octaves: optionTypes.octaves.default,
  seed: optionTypes.seed.default,
  colorize: optionTypes.colorize.default,
  mix: optionTypes.mix.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Hash function for gradient generation
const hash = (x: number, y: number, seed: number) => {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return h;
};

// 2D gradient noise (Perlin-like)
const gradientNoise = (px: number, py: number, seed: number) => {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;

  // Smoothstep
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  // Gradient dot products at corners
  const dot = (cx: number, cy: number) => {
    const h = hash(cx, cy, seed) & 3;
    const gx = [1, -1, 1, -1][h];
    const gy = [1, 1, -1, -1][h];
    return gx * (px - cx) + gy * (py - cy);
  };

  const n00 = dot(x0, y0);
  const n10 = dot(x0 + 1, y0);
  const n01 = dot(x0, y0 + 1);
  const n11 = dot(x0 + 1, y0 + 1);

  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0);
};

// Simplex-like 2D noise
const simplexNoise = (px: number, py: number, seed: number) => {
  // Use skewed grid
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  const s = (px + py) * F2;
  const i = Math.floor(px + s);
  const j = Math.floor(py + s);
  const t = (i + j) * G2;
  const x0 = px - (i - t);
  const y0 = py - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const contrib = (cx: number, cy: number, dx: number, dy: number) => {
    const t = 0.5 - dx * dx - dy * dy;
    if (t < 0) return 0;
    const h = hash(cx, cy, seed) & 3;
    const gx = [1, -1, 1, -1][h];
    const gy = [1, 1, -1, -1][h];
    return t * t * t * t * (gx * dx + gy * dy);
  };

  return 70 * (contrib(i, j, x0, y0) + contrib(i + i1, j + j1, x1, y1) + contrib(i + 1, j + 1, x2, y2));
};

// Worley (cellular) noise
const worleyNoise = (px: number, py: number, seed: number) => {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let minDist = Infinity;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const h = hash(cx, cy, seed);
      const fpx = cx + ((h & 0xffff) / 65536);
      const fpy = cy + (((h >> 16) & 0xffff) / 65536);
      const ddx = px - fpx;
      const ddy = py - fpy;
      minDist = Math.min(minDist, ddx * ddx + ddy * ddy);
    }
  }

  return Math.sqrt(minDist);
};

const noiseGenerator = (input, options: any = defaults) => {
  const { type, scale, octaves, seed: seedOpt, colorize, mix, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const noiseFn = type === NOISE_TYPE.WORLEY ? worleyNoise :
                  type === NOISE_TYPE.SIMPLEX ? simplexNoise : gradientNoise;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Fractal Brownian motion
      let value = 0;
      let amplitude = 1;
      let frequency = 1;
      let maxAmp = 0;

      for (let o = 0; o < octaves; o++) {
        const nx = (x / scale) * frequency;
        const ny = (y / scale) * frequency;
        value += noiseFn(nx, ny, seedOpt + o * 1000 + frameIndex * 7) * amplitude;
        maxAmp += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }

      // Normalize to 0-1
      let n = (value / maxAmp + 1) * 0.5;
      n = Math.max(0, Math.min(1, n));

      let r: number, g: number, b: number;
      if (colorize) {
        // Use noise to index a rainbow
        const hue = n * 360;
        const s2 = 0.8;
        const l = 0.5;
        const c = (1 - Math.abs(2 * l - 1)) * s2;
        const x2 = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = l - c / 2;
        let r1 = 0, g1 = 0, b1 = 0;
        if (hue < 60) { r1 = c; g1 = x2; }
        else if (hue < 120) { r1 = x2; g1 = c; }
        else if (hue < 180) { g1 = c; b1 = x2; }
        else if (hue < 240) { g1 = x2; b1 = c; }
        else if (hue < 300) { r1 = x2; b1 = c; }
        else { r1 = c; b1 = x2; }
        r = Math.round((r1 + m) * 255);
        g = Math.round((g1 + m) * 255);
        b = Math.round((b1 + m) * 255);
      } else {
        r = g = b = Math.round(n * 255);
      }

      // Mix with input
      const mr = Math.round(buf[i] * (1 - mix) + r * mix);
      const mg = Math.round(buf[i + 1] * (1 - mix) + g * mix);
      const mb = Math.round(buf[i + 2] * (1 - mix) + b * mix);

      const color = paletteGetColor(palette, rgba(mr, mg, mb, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Noise Generator",
  func: noiseGenerator,
  optionTypes,
  options: defaults,
  defaults
};
