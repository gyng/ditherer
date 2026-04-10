import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  scale: { type: RANGE, range: [5, 200], step: 5, default: 50, desc: "Turbulence noise feature size" },
  strength: { type: RANGE, range: [0, 100], step: 1, default: 20, desc: "Pixel displacement distance" },
  octaves: { type: RANGE, range: [1, 6], step: 1, default: 3, desc: "Fractal detail layers" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for noise pattern" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  octaves: optionTypes.octaves.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const hash = (x: number, y: number, seed: number) => {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

const noise2d = (px: number, py: number, seed: number) => {
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const n00 = hash(x0, y0, seed) * 2 - 1;
  const n10 = hash(x0 + 1, y0, seed) * 2 - 1;
  const n01 = hash(x0, y0 + 1, seed) * 2 - 1;
  const n11 = hash(x0 + 1, y0 + 1, seed) * 2 - 1;
  return n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
};

const fbm = (x: number, y: number, octaves: number, seed: number) => {
  let value = 0, amp = 1, freq = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise2d(x * freq, y * freq, seed + i * 1000) * amp;
    maxAmp += amp; amp *= 0.5; freq *= 2;
  }
  return value / maxAmp;
};

const turbulence = (input, options: any = defaults) => {
  const { scale, strength, octaves, seed, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / scale, ny = y / scale;
      const dx = fbm(nx, ny, octaves, seed) * strength;
      const dy = fbm(nx, ny, octaves, seed + 500) * strength;

      const sx = x + dx, sy = y + dy;
      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Turbulence", func: turbulence, optionTypes, options: defaults, defaults };
