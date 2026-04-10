import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, paletteGetColor, rgba } from "utils";

const DRIFT = {
  ROTATE: "ROTATE",
  SWAP: "SWAP",
  BANK_SHIFT: "BANK_SHIFT",
};

let driftMap: number[] = [];
let driftSize = 0;

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const buildPalette = (src: Uint8ClampedArray, size: number, palette) => {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i];
    let g = src[i + 1];
    let b = src[i + 2];
    if (palette && typeof palette.getColor === "function") {
      const c = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      r = c[0];
      g = c[1];
      b = c[2];
    }

    const key = (r << 16) | (g << 8) | b;
    const hit = bins.get(key);
    if (hit) {
      hit.count += 1;
      hit.r += r;
      hit.g += g;
      hit.b += b;
    } else {
      bins.set(key, { count: 1, r, g, b });
    }
  }

  const entries = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(2, size));

  if (entries.length === 0) {
    return [[0, 0, 0], [255, 255, 255]];
  }

  return entries.map((e) => [Math.round(e.r / e.count), Math.round(e.g / e.count), Math.round(e.b / e.count)]);
};

const nearestPaletteIndex = (r: number, g: number, b: number, palette: number[][]) => {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

const ensureDriftMap = (size: number) => {
  if (size !== driftSize || driftMap.length !== size) {
    driftMap = Array.from({ length: size }, (_, i) => i);
    driftSize = size;
  }
};

const applyDrift = (mode: string, driftRate: number, rng: () => number) => {
  if (driftMap.length < 2 || rng() >= driftRate) return;

  if (mode === DRIFT.ROTATE) {
    const dir = rng() < 0.5 ? -1 : 1;
    if (dir > 0) driftMap.unshift(driftMap.pop() as number);
    else driftMap.push(driftMap.shift() as number);
    return;
  }

  if (mode === DRIFT.SWAP) {
    const swaps = Math.max(1, Math.round(driftRate * driftMap.length * 0.35));
    for (let s = 0; s < swaps; s++) {
      const a = Math.floor(rng() * driftMap.length);
      const b = Math.floor(rng() * driftMap.length);
      const t = driftMap[a];
      driftMap[a] = driftMap[b];
      driftMap[b] = t;
    }
    return;
  }

  const bank = 4;
  const banks = Math.max(1, Math.floor(driftMap.length / bank));
  if (banks <= 1) return;
  const bankOrder = Array.from({ length: banks }, (_, i) => i);
  bankOrder.unshift(bankOrder.pop() as number);

  const copy = [...driftMap];
  for (let b = 0; b < banks; b++) {
    const srcBank = bankOrder[b];
    for (let i = 0; i < bank; i++) {
      const dst = b * bank + i;
      const src = srcBank * bank + i;
      if (dst < driftMap.length && src < copy.length) driftMap[dst] = copy[src];
    }
  }
};

export const optionTypes = {
  paletteSize: { type: RANGE, range: [2, 96], step: 1, default: 24, desc: "Number of indexed colors used before drift remapping" },
  driftMode: {
    type: ENUM,
    default: DRIFT.ROTATE,
    options: [
      { name: "Rotate indices", value: DRIFT.ROTATE },
      { name: "Swap indices", value: DRIFT.SWAP },
      { name: "Bank shift", value: DRIFT.BANK_SHIFT },
    ],
    desc: "How index table corruption evolves over time"
  },
  driftRate: { type: RANGE, range: [0, 1], step: 0.01, default: 0.2, desc: "Probability/intensity of index table drift per frame" },
  lockLuma: { type: BOOL, default: true, desc: "Preserve source luminance while palette indices drift" },
  ditherBeforeIndex: { type: BOOL, default: true, desc: "Inject subtle noise before index lookup to mimic unstable quantizers" },
  palette: { type: PALETTE, default: nearest },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    }
  },
};

export const defaults = {
  paletteSize: optionTypes.paletteSize.default,
  driftMode: optionTypes.driftMode.default,
  driftRate: optionTypes.driftRate.default,
  lockLuma: optionTypes.lockLuma.default,
  ditherBeforeIndex: optionTypes.ditherBeforeIndex.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
  animSpeed: optionTypes.animSpeed.default,
};

const paletteIndexDrift = (input, options: any = defaults) => {
  const { paletteSize, driftMode, driftRate, lockLuma, ditherBeforeIndex, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const w = input.width;
  const h = input.height;
  const src = inputCtx.getImageData(0, 0, w, h).data;
  const outBuf = new Uint8ClampedArray(src.length);

  const indexPalette = buildPalette(src, Math.max(2, Math.round(paletteSize)), palette);
  ensureDriftMap(indexPalette.length);

  const rng = mulberry32(frameIndex * 4591 + 71);
  applyDrift(driftMode, driftRate, rng);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = getBufferIndex(x, y, w);
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];

      if (ditherBeforeIndex) {
        const n = (rng() - 0.5) * 14;
        r = Math.max(0, Math.min(255, r + n));
        g = Math.max(0, Math.min(255, g + n));
        b = Math.max(0, Math.min(255, b + n));
      }

      const srcLum = luminance(src[i], src[i + 1], src[i + 2]);
      const idx = nearestPaletteIndex(r, g, b, indexPalette);
      const drifted = indexPalette[driftMap[idx] ?? idx];

      let rr = drifted[0];
      let gg = drifted[1];
      let bb = drifted[2];

      if (lockLuma) {
        const dstLum = Math.max(1, luminance(rr, gg, bb));
        const s = srcLum / dstLum;
        rr = Math.max(0, Math.min(255, rr * s));
        gg = Math.max(0, Math.min(255, gg * s));
        bb = Math.max(0, Math.min(255, bb * s));
      }

      fillBufferPixel(outBuf, i, rr, gg, bb, src[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, w, h), 0, 0);
  return output;
};

export default {
  name: "Palette Index Drift",
  func: paletteIndexDrift,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Map into an indexed palette, then drift the lookup table over time so colors break while geometry stays stable"
};
