import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { THEMES } from "palettes/user";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  color1: { type: COLOR, default: THEMES.RISOGRAPH[1].slice(0, 3), desc: "First ink color" },
  color2: { type: COLOR, default: THEMES.RISOGRAPH[2].slice(0, 3), desc: "Second ink color" },
  misregX: { type: RANGE, range: [0, 20], step: 1, default: 4, desc: "Horizontal misregistration offset" },
  misregY: { type: RANGE, range: [0, 20], step: 1, default: 2, desc: "Vertical misregistration offset" },
  grain: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Paper texture grain amount" },
  inkBleed: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Ink spreading/bleeding amount" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance split for two-color separation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  misregX: optionTypes.misregX.default,
  misregY: optionTypes.misregY.default,
  grain: optionTypes.grain.default,
  inkBleed: optionTypes.inkBleed.default,
  threshold: optionTypes.threshold.default,
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

type RisographOptions = FilterOptionValues & {
  color1?: number[];
  color2?: number[];
  misregX?: number;
  misregY?: number;
  grain?: number;
  inkBleed?: number;
  threshold?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
};

const risograph = (input: any, options: RisographOptions = defaults) => {
  const { color1, color2, misregX, misregY, grain, inkBleed, threshold, palette } = options;
  const frameIndex = Number(options._frameIndex ?? 0);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Compute luminance
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }
  }

  // Slight blur for ink bleed effect
  const blurred = new Float32Array(W * H);
  const blurR = Math.max(1, Math.round(inkBleed * 3));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let ky = -blurR; ky <= blurR; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -blurR; kx <= blurR; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          sum += lum[ny * W + nx];
          cnt++;
        }
      }
      blurred[y * W + x] = sum / cnt;
    }
  }

  // Render: two-color separation with misregistration
  // Fill with paper white
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = 245; outBuf[i + 1] = 240; outBuf[i + 2] = 235; outBuf[i + 3] = 255;
  }

  // Layer 1: color1 (no offset)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = blurred[y * W + x];
      if (l >= threshold) continue;

      const darkness = (1 - l / 255);
      // Grain noise
      const n = grain > 0 ? (rng() - 0.5) * grain * 100 : 0;
      const intensity = Math.max(0, Math.min(1, darkness + n / 255));

      const i = getBufferIndex(x, y, W);
      // Multiply blend with paper
      outBuf[i] = Math.round(outBuf[i] * (1 - intensity) + color1[0] * intensity);
      outBuf[i + 1] = Math.round(outBuf[i + 1] * (1 - intensity) + color1[1] * intensity);
      outBuf[i + 2] = Math.round(outBuf[i + 2] * (1 - intensity) + color1[2] * intensity);
    }
  }

  // Layer 2: color2 (with misregistration offset)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const srcX = Math.max(0, Math.min(W - 1, x - misregX));
      const srcY = Math.max(0, Math.min(H - 1, y - misregY));
      const l = blurred[srcY * W + srcX];
      if (l < threshold) continue;

      const brightness = l / 255;
      const n = grain > 0 ? (rng() - 0.5) * grain * 100 : 0;
      const intensity = Math.max(0, Math.min(1, brightness + n / 255));

      const i = getBufferIndex(x, y, W);
      // Multiply blend
      outBuf[i] = Math.round(outBuf[i] * (1 - intensity * 0.7) + color2[0] * intensity * 0.7);
      outBuf[i + 1] = Math.round(outBuf[i + 1] * (1 - intensity * 0.7) + color2[1] * intensity * 0.7);
      outBuf[i + 2] = Math.round(outBuf[i + 2] * (1 - intensity * 0.7) + color2[2] * intensity * 0.7);
    }
  }

  // Apply palette
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Risograph",
  func: risograph,
  optionTypes,
  options: defaults,
  defaults
});
