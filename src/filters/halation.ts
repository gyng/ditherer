import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { halationGLAvailable, renderHalationGL } from "./halationGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 60], step: 1, default: 18, desc: "Glow spread — how far the halation bleed reaches around bright areas" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 100, desc: "Brightness cutoff for what contributes to the halation glow" },
  strength: { type: RANGE, range: [0, 2], step: 0.05, default: 0.9, desc: "Intensity of the screen-blended glow" },
  tint: { type: COLOR, default: [255, 60, 40], desc: "Halation colour — CineStill 800T's pink-red default emulates the missing anti-halation layer" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  tint: optionTypes.tint.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type HalationOptions = typeof defaults & { _webglAcceleration?: boolean };

const halation = (input: any, options: HalationOptions = defaults) => {
  const { radius, threshold, strength, tint, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && halationGLAvailable()) {
    const rendered = renderHalationGL(input, W, H, radius, threshold, strength, tint);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Halation", "WebGL2", `r=${radius} thr=${threshold}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  logFilterWasmStatus("Halation", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Extract tinted highlights.
  const sigma = Math.max(1, radius);
  const kr = Math.min(60, Math.ceil(sigma * 3));
  const weights: number[] = [];
  let wsum = 0;
  for (let k = -kr; k <= kr; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); weights.push(w); wsum += w; }
  for (let i = 0; i < weights.length; i++) weights[i] /= wsum;

  const extR = new Float32Array(W * H), extG = new Float32Array(W * H), extB = new Float32Array(W * H);
  const thrN = threshold / 255;
  const tintN = [tint[0] / 255, tint[1] / 255, tint[2] / 255];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const cr = buf[i] / 255, cg = buf[i + 1] / 255, cb = buf[i + 2] / 255;
      const l = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      const excess = Math.max(0, l - thrN);
      const pi = y * W + x;
      extR[pi] = (tintN[0] * 0.7 + cr * 0.3) * excess;
      extG[pi] = (tintN[1] * 0.7 + cg * 0.3) * excess;
      extB[pi] = (tintN[2] * 0.7 + cb * 0.3) * excess;
    }

  // Separable blur.
  const tmpR = new Float32Array(W * H), tmpG = new Float32Array(W * H), tmpB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = -kr; k <= kr; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const pi = y * W + nx;
        const w = weights[k + kr];
        r += extR[pi] * w; g += extG[pi] * w; b += extB[pi] * w;
      }
      const pi = y * W + x;
      tmpR[pi] = r; tmpG[pi] = g; tmpB[pi] = b;
    }
  const blurR = new Float32Array(W * H), blurG = new Float32Array(W * H), blurB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = -kr; k <= kr; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const pi = ny * W + x;
        const w = weights[k + kr];
        r += tmpR[pi] * w; g += tmpG[pi] * w; b += tmpB[pi] * w;
      }
      const pi = y * W + x;
      blurR[pi] = r; blurG[pi] = g; blurB[pi] = b;
    }

  // Screen composite.
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const pi = y * W + x;
      const sr = buf[i] / 255, sg = buf[i + 1] / 255, sb = buf[i + 2] / 255;
      const hr = blurR[pi] * strength, hg = blurG[pi] * strength, hb = blurB[pi] * strength;
      const outR = 1 - (1 - sr) * (1 - hr);
      const outG = 1 - (1 - sg) * (1 - hg);
      const outB = 1 - (1 - sb) * (1 - hb);
      outBuf[i] = Math.max(0, Math.min(255, Math.round(outR * 255)));
      outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(outG * 255)));
      outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(outB * 255)));
      outBuf[i + 3] = buf[i + 3];
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  const identity = paletteIsIdentity(palette);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Halation",
  func: halation,
  optionTypes,
  options: defaults,
  defaults,
  description: "Pink-red glow around highlights — mimics CineStill 800T and other films where light bleeds through a missing anti-halation layer"
});
