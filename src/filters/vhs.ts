import { ACTION, BOOL, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

import convolve, {
  GAUSSIAN_3X3_WEAK,
  defaults as convolveDefaults
} from "./convolve";

export const optionTypes = {
  tracking: { type: RANGE, range: [0, 30], step: 1, default: 3, desc: "Random horizontal row shift per scanline" },
  trackingSpread: { type: RANGE, range: [0, 2], step: 0.05, default: 0.5, desc: "How much row drift carries over to the next line" },
  flagging: { type: RANGE, range: [0, 40], step: 1, default: 8, desc: "Horizontal bending at the top of the frame" },
  flaggingHeight: { type: RANGE, range: [0, 60], step: 1, default: 15, desc: "Number of rows affected by top-edge flagging" },
  verticalJitter: { type: RANGE, range: [0, 20], step: 1, default: 1, desc: "Whole-frame vertical bounce per frame" },
  chromaDelay: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Color channel horizontal offset from luma (pixels)" },
  headSwitching: { type: RANGE, range: [0, 50], step: 1, default: 12, desc: "Distortion band intensity near the bottom edge" },
  headSwitchingHeight: { type: RANGE, range: [0, 80], step: 1, default: 20, desc: "Height of the bottom-edge head switching band" },
  dropout: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Probability of white signal-loss streaks per frame" },
  tapeNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Per-row brightness noise and static bar frequency" },
  ghosting: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Previous-frame bleed-through (temporal smear)" },
  brightness: { type: RANGE, range: [-100, 100], step: 1, default: -15, desc: "Overall brightness offset applied after VHS processing" },
  saturation: { type: RANGE, range: [0, 2], step: 0.05, default: 1.1, desc: "Chroma saturation multiplier" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
      }
    }
  },
  blur: { type: BOOL, default: true, desc: "Apply soft Gaussian blur to simulate analog softness" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  tracking: optionTypes.tracking.default,
  trackingSpread: optionTypes.trackingSpread.default,
  flagging: optionTypes.flagging.default,
  flaggingHeight: optionTypes.flaggingHeight.default,
  verticalJitter: optionTypes.verticalJitter.default,
  chromaDelay: optionTypes.chromaDelay.default,
  headSwitching: optionTypes.headSwitching.default,
  headSwitchingHeight: optionTypes.headSwitchingHeight.default,
  dropout: optionTypes.dropout.default,
  tapeNoise: optionTypes.tapeNoise.default,
  ghosting: optionTypes.ghosting.default,
  brightness: optionTypes.brightness.default,
  saturation: optionTypes.saturation.default,
  animSpeed: optionTypes.animSpeed.default,
  blur: optionTypes.blur.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type VhsPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type VhsOptions = FilterOptionValues & {
  tracking?: number;
  trackingSpread?: number;
  flagging?: number;
  flaggingHeight?: number;
  verticalJitter?: number;
  chromaDelay?: number;
  headSwitching?: number;
  headSwitchingHeight?: number;
  dropout?: number;
  tapeNoise?: number;
  ghosting?: number;
  brightness?: number;
  saturation?: number;
  animSpeed?: number;
  blur?: boolean;
  palette?: VhsPalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
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

const vhs = (
  input: any,
  options: VhsOptions = defaults
) => {
  const {
    tracking,
    trackingSpread,
    flagging,
    flaggingHeight,
    verticalJitter,
    chromaDelay,
    headSwitching,
    headSwitchingHeight,
    dropout,
    tapeNoise,
    ghosting,
    brightness,
    saturation,
    blur: doBlur,
    palette
  } = options;

  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);

  let output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Per-frame seeded random for consistent-looking noise within a frame
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Vertical jitter — whole frame shifts up/down per frame
  const vJitter = verticalJitter > 0
    ? Math.round(Math.sin(frameIndex * 3.7 + Math.cos(frameIndex * 1.3)) * verticalJitter)
    : 0;

  // Pre-compute horizontal tracking jitter per row (random walk)
  const rowShift = new Int32Array(H);
  let drift = 0;
  for (let y = 0; y < H; y++) {
    drift += (rng() - 0.5) * tracking * 2;
    drift *= trackingSpread;
    rowShift[y] = Math.round(drift);
  }

  // Flagging — top rows bend/hook horizontally, worse at very top
  if (flagging > 0 && flaggingHeight > 0) {
    const flagWobble = Math.sin(frameIndex * 0.9) * 0.5 + 0.5;
    for (let y = 0; y < Math.min(flaggingHeight, H); y++) {
      const t = 1 - y / flaggingHeight; // 1 at top, 0 at bottom of flag zone
      rowShift[y] += Math.round(flagging * t * t * (1 + flagWobble * 0.5)
        * Math.sin(frameIndex * 2.1 + t * 3));
    }
  }

  // Head-switching: strong distortion band near bottom of frame
  const hsStart = H - headSwitchingHeight;
  const hsRng = mulberry32(frameIndex * 1013 + 7);
  for (let y = hsStart; y < H; y++) {
    const intensity = ((y - hsStart) / headSwitchingHeight);
    rowShift[y] += Math.round((hsRng() - 0.3) * headSwitching * intensity * intensity);
  }

  // Dropout: random horizontal streaks of signal loss
  const dropouts: Array<{ y: number; x: number; w: number }> = [];
  if (dropout > 0) {
    const dropRng = mulberry32(frameIndex * 4391 + 17);
    const dropCount = Math.floor(dropRng() * 8 * dropout);
    for (let d = 0; d < dropCount; d++) {
      dropouts.push({
        y: Math.floor(dropRng() * H),
        x: Math.floor(dropRng() * W),
        w: 20 + Math.floor(dropRng() * W * 0.4)
      });
    }
  }

  // Per-frame chroma delay wobble
  const chromaOffX = Math.round(Math.sin(frameIndex * 0.73) * chromaDelay);
  const chromaOffY = Math.round(Math.cos(frameIndex * 0.51) * chromaDelay * 0.3);

  // Per-row tape noise (brightness variation)
  const rowNoise = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    rowNoise[y] = 1 + (rng() - 0.5) * tapeNoise * 2;
  }

  // Occasional horizontal noise bars (2-4px tall bands of static)
  const noiseBars: Array<{ y: number; h: number }> = [];
  if (tapeNoise > 0) {
    const barCount = Math.floor(rng() * 4 * tapeNoise);
    for (let b = 0; b < barCount; b++) {
      noiseBars.push({
        y: Math.floor(rng() * H),
        h: 2 + Math.floor(rng() * 3)
      });
    }
  }

  for (let y = 0; y < H; y++) {
    const shift = rowShift[y];
    const noise = rowNoise[y];

    // Check if this row is in a noise bar
    let inNoiseBar = false;
    for (const bar of noiseBars) {
      if (y >= bar.y && y < bar.y + bar.h) {
        inNoiseBar = true;
        break;
      }
    }

    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      if (inNoiseBar) {
        // Static noise — random RGB
        const n = Math.floor(rng() * 256);
        fillBufferPixel(outBuf, i, n, n, n, 255);
        continue;
      }

      // Check if this pixel is in a dropout streak
      let inDropout = false;
      for (const drop of dropouts) {
        if (y === drop.y && x >= drop.x && x < drop.x + drop.w) {
          inDropout = true;
          break;
        }
      }
      if (inDropout) {
        // Dropout — white snow streak with some noise
        const n = 180 + Math.floor(rng() * 75);
        fillBufferPixel(outBuf, i, n, n, n, 255);
        continue;
      }

      // Luma from tracking-shifted + vertically jittered position
      const srcY = Math.max(0, Math.min(H - 1, y + vJitter));
      const lumaX = Math.max(0, Math.min(W - 1, x + shift));
      const lumaI = getBufferIndex(lumaX, srcY, W);

      // Chroma from delayed/offset position (VHS records chroma separately)
      const chromaX = Math.max(0, Math.min(W - 1, x + shift + chromaOffX));
      const chromaY = Math.max(0, Math.min(H - 1, srcY + chromaOffY));
      const chromaI = getBufferIndex(chromaX, chromaY, W);

      // Extract luma from shifted position
      const luma = buf[lumaI] * 0.2126 + buf[lumaI + 1] * 0.7152 + buf[lumaI + 2] * 0.0722;

      // Extract chroma from delayed position
      const cR = buf[chromaI] - (buf[chromaI] * 0.2126 + buf[chromaI + 1] * 0.7152 + buf[chromaI + 2] * 0.0722);
      const cG = buf[chromaI + 1] - (buf[chromaI] * 0.2126 + buf[chromaI + 1] * 0.7152 + buf[chromaI + 2] * 0.0722);
      const cB = buf[chromaI + 2] - (buf[chromaI] * 0.2126 + buf[chromaI + 1] * 0.7152 + buf[chromaI + 2] * 0.0722);

      // Recombine luma + chroma with reduced saturation and brightness adjust
      let r = (luma + cR * saturation + brightness) * noise;
      let g = (luma + cG * saturation + brightness) * noise;
      let b = (luma + cB * saturation + brightness) * noise;

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[lumaI + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[lumaI + 3]);
    }
  }

  // Ghosting: blend with previous frame (tape head smear)
  if (ghosting > 0 && prevOutput && prevOutput.length === outBuf.length) {
    const keep = ghosting;
    const fresh = 1 - keep;
    for (let j = 0; j < outBuf.length; j += 4) {
      outBuf[j]     = Math.min(255, outBuf[j] * fresh + prevOutput[j] * keep);
      outBuf[j + 1] = Math.min(255, outBuf[j + 1] * fresh + prevOutput[j + 1] * keep);
      outBuf[j + 2] = Math.min(255, outBuf[j + 2] * fresh + prevOutput[j + 2] * keep);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  if (doBlur) {
    const maybeBlurred = convolve.func(output, {
      ...convolveDefaults,
      kernel: GAUSSIAN_3X3_WEAK
    });
    if (maybeBlurred instanceof HTMLCanvasElement) {
      output = maybeBlurred;
    }
  }

  return output;
};

export default defineFilter({
  name: "VHS emulation",
  func: vhs,
  options: defaults,
  optionTypes,
  defaults,
  mainThread: true
});
