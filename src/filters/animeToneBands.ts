import { BOOL, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { clamp, cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp(0, 1, (value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const quantizeTone = (value: number, steps: number) => {
  const clamped = clamp(0, 1, value);
  const count = Math.max(2, Math.round(steps));
  return Math.round(clamped * (count - 1)) / Math.max(1, count - 1);
};

export const optionTypes = {
  shadowSteps: { type: RANGE, range: [2, 8], step: 1, default: 3, desc: "How many broad bands to keep in darker regions" },
  highlightSteps: { type: RANGE, range: [2, 8], step: 1, default: 4, desc: "How many broad bands to keep in brighter regions" },
  edgeSoftness: { type: RANGE, range: [0, 0.35], step: 0.01, default: 0.08, desc: "Soft blend zone around tone-band boundaries" },
  bandBias: { type: RANGE, range: [-0.4, 0.4], step: 0.05, default: 0.05, desc: "Bias more band detail toward shadows or highlights" },
  preserveSkin: { type: BOOL, default: true, desc: "Reduce banding on likely skin tones" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "Blend the tone-banded result over the source image" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  shadowSteps: optionTypes.shadowSteps.default,
  highlightSteps: optionTypes.highlightSteps.default,
  edgeSoftness: optionTypes.edgeSoftness.default,
  bandBias: optionTypes.bandBias.default,
  preserveSkin: optionTypes.preserveSkin.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeToneBands = (input: any, options = defaults) => {
  const { shadowSteps, highlightSteps, edgeSoftness, bandBias, preserveSkin, mix, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  // Pure per-pixel f64 math (luma, smoothstep, lerp, skin compares) with no
  // expensive transfer functions to LUT away — V8 turbofan wins against a
  // straight WASM port (benched at 0.82x). Stays on JS; revisit if we find a
  // luma-indexed LUT or SIMD approach that actually helps.

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];

      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const biased = clamp(0, 1, luma + bandBias * (0.5 - luma));
      const useShadowSteps = biased < 0.5;
      const steps = useShadowSteps ? shadowSteps : highlightSteps;
      const quantized = quantizeTone(biased, steps);
      const softMix = edgeSoftness > 0
        ? smoothstep(0, edgeSoftness, Math.abs(biased - quantized))
        : 1;
      let targetLuma = lerp(quantized, biased, softMix * 0.5);

      if (preserveSkin) {
        const skinish = r > g && g > b && r - b > 18 && g - b > 8;
        if (skinish) {
          targetLuma = lerp(targetLuma, luma, 0.45);
        }
      }

      const scale = luma <= 0.001 ? targetLuma : targetLuma / luma;
      const bandR = clamp(0, 255, Math.round(r * scale));
      const bandG = clamp(0, 255, Math.round(g * scale));
      const bandB = clamp(0, 255, Math.round(b * scale));

      const finalR = clamp(0, 255, Math.round(lerp(r, bandR, mix)));
      const finalG = clamp(0, 255, Math.round(lerp(g, bandG, mix)));
      const finalB = clamp(0, 255, Math.round(lerp(b, bandB, mix)));
      const color = srgbPaletteGetColor(palette, rgba(finalR, finalG, finalB, a), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anime Tone Bands",
  func: animeToneBands,
  optionTypes,
  options: defaults,
  defaults,
});
