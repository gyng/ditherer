import { ACTION, ENUM, RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const COLORMAP_IRONBOW = "IRONBOW";
const COLORMAP_RAINBOW = "RAINBOW";
const COLORMAP_WHITE_HOT = "WHITE_HOT";
const COLORMAP_BLACK_HOT = "BLACK_HOT";

// Gradient color stops for each thermal colormap
const colormaps: Record<string, number[][]> = {
  [COLORMAP_IRONBOW]: [
    [0, 0, 0],
    [20, 0, 80],
    [80, 0, 120],
    [160, 0, 100],
    [220, 60, 20],
    [255, 180, 0],
    [255, 255, 100],
    [255, 255, 255]
  ],
  [COLORMAP_RAINBOW]: [
    [0, 0, 40],
    [0, 0, 200],
    [0, 180, 255],
    [0, 220, 80],
    [200, 220, 0],
    [255, 120, 0],
    [255, 0, 0],
    [255, 255, 255]
  ],
  [COLORMAP_WHITE_HOT]: [
    [0, 0, 0],
    [30, 30, 30],
    [80, 80, 80],
    [130, 130, 130],
    [180, 180, 180],
    [220, 220, 220],
    [255, 255, 255]
  ],
  [COLORMAP_BLACK_HOT]: [
    [255, 255, 255],
    [220, 220, 220],
    [180, 180, 180],
    [130, 130, 130],
    [80, 80, 80],
    [30, 30, 30],
    [0, 0, 0]
  ]
};

// Interpolate through a gradient's color stops given a normalized value [0, 1]
const sampleGradient = (stops: number[][], t: number): [number, number, number] => {
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (stops.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;

  if (idx >= stops.length - 1) {
    return [stops[stops.length - 1][0], stops[stops.length - 1][1], stops[stops.length - 1][2]];
  }

  const a = stops[idx];
  const b = stops[idx + 1];
  return [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac
  ];
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

export const optionTypes = {
  colormap: {
    type: ENUM,
    options: [
      { name: "Ironbow", value: COLORMAP_IRONBOW },
      { name: "Rainbow", value: COLORMAP_RAINBOW },
      { name: "White Hot", value: COLORMAP_WHITE_HOT },
      { name: "Black Hot", value: COLORMAP_BLACK_HOT }
    ],
    default: COLORMAP_IRONBOW
  },
  contrast:     { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.2 },
  noiseAmount:  { type: RANGE, range: [0, 0.3], step: 0.005, default: 0.05 },
  crosshair:    { type: BOOL, default: true },
  animSpeed:    { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
    }
  },
  palette:      { type: PALETTE, default: nearest }
};

export const defaults = {
  colormap: optionTypes.colormap.default,
  contrast: optionTypes.contrast.default,
  noiseAmount: optionTypes.noiseAmount.default,
  crosshair: optionTypes.crosshair.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const thermalCamera = (input, options = defaults) => {
  const {
    colormap,
    contrast,
    noiseAmount,
    crosshair,
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
  const outBuf = new Uint8ClampedArray(buf.length);

  const stops = colormaps[colormap] || colormaps[COLORMAP_IRONBOW];
  const rng = mulberry32(frameIndex * 7919 + 31337);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Convert to luminance
      const lum = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;

      // Apply contrast around midpoint
      const contrasted = Math.max(0, Math.min(1, (lum - 0.5) * contrast + 0.5));

      // Add thermal noise
      const noise = (rng() - 0.5) * noiseAmount;
      const value = Math.max(0, Math.min(1, contrasted + noise));

      // Map through false-color gradient
      const [cr, cg, cb] = sampleGradient(stops, value);

      // Apply palette quantization
      const color = paletteGetColor(palette, rgba(cr, cg, cb, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  // Draw crosshair at center using the "hot" color from the palette
  if (crosshair) {
    const hotColor = sampleGradient(stops, 0.85);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    const armLen = Math.min(W, H) * 0.04;
    const gap = Math.max(2, Math.floor(armLen * 0.4));

    // Horizontal arms
    for (let x = cx - Math.floor(armLen) - gap; x <= cx + Math.floor(armLen) + gap; x++) {
      if (x < 0 || x >= W) continue;
      if (Math.abs(x - cx) < gap) continue;
      const idx = getBufferIndex(x, cy, W);
      fillBufferPixel(outBuf, idx, hotColor[0], hotColor[1], hotColor[2], 255);
    }

    // Vertical arms
    for (let y = cy - Math.floor(armLen) - gap; y <= cy + Math.floor(armLen) + gap; y++) {
      if (y < 0 || y >= H) continue;
      if (Math.abs(y - cy) < gap) continue;
      const idx = getBufferIndex(cx, y, W);
      fillBufferPixel(outBuf, idx, hotColor[0], hotColor[1], hotColor[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Thermal camera",
  func: thermalCamera,
  options: defaults,
  optionTypes,
  defaults
};
