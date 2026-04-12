import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { THEMES } from "palettes/user";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  color1: { type: COLOR, default: THEMES.RISOGRAPH[1].slice(0, 3), desc: "First ink color" },
  color2: { type: COLOR, default: THEMES.RISOGRAPH[2].slice(0, 3), desc: "Second ink color" },
  color3: { type: COLOR, default: THEMES.RISOGRAPH[4].slice(0, 3), desc: "Third ink color" },
  color4: { type: COLOR, default: THEMES.RISOGRAPH[3].slice(0, 3), desc: "Fourth ink color" },
  layers: { type: RANGE, range: [2, 4], step: 1, default: 3, desc: "Number of ink layers to print" },
  misregistration: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Print alignment error in pixels" },
  grain: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Paper texture grain amount" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  color3: optionTypes.color3.default,
  color4: optionTypes.color4.default,
  layers: optionTypes.layers.default,
  misregistration: optionTypes.misregistration.default,
  grain: optionTypes.grain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const risographMulti = (input, options = defaults) => {
  const { color1, color2, color3, color4, layers, misregistration, grain, palette } = options;
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

  // Compute luminance
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    }

  // Paper
  for (let i = 0; i < outBuf.length; i += 4) { outBuf[i] = 245; outBuf[i + 1] = 240; outBuf[i + 2] = 235; outBuf[i + 3] = 255; }

  const colors = [color1, color2, color3, color4].slice(0, layers);
  const thresholds = colors.map((_, i) => (i + 1) / (colors.length + 1));

  for (let li = 0; li < colors.length; li++) {
    const c = colors[li];
    const thresh = thresholds[li];
    // Per-layer misregistration
    const offX = Math.round((rng() - 0.5) * misregistration * 2);
    const offY = Math.round((rng() - 0.5) * misregistration * 2);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcX = Math.max(0, Math.min(W - 1, x - offX));
        const srcY = Math.max(0, Math.min(H - 1, y - offY));
        const l = lum[srcY * W + srcX];

        // Each layer prints in a luminance band
        const bandDist = Math.abs(l - thresh);
        if (bandDist > 0.3) continue;

        const intensity = Math.max(0, (0.3 - bandDist) / 0.3) * 0.7;
        const n = grain > 0 ? (rng() - 0.5) * grain * 0.3 : 0;
        const ink = Math.max(0, Math.min(1, intensity + n));

        const i = getBufferIndex(x, y, W);
        // Multiply blend
        outBuf[i] = Math.round(outBuf[i] * (1 - ink) + c[0] * ink);
        outBuf[i + 1] = Math.round(outBuf[i + 1] * (1 - ink) + c[1] * ink);
        outBuf[i + 2] = Math.round(outBuf[i + 2] * (1 - ink) + c[2] * ink);
      }
    }
  }

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Risograph (multi-layer)", func: risographMulti, optionTypes, options: defaults, defaults });
