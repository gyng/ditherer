import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { sumiEGLAvailable, renderSumiEGL } from "./sumiEGL";

export const optionTypes = {
  brushSoftness: { type: RANGE, range: [0.5, 12], step: 0.5, default: 3, desc: "Gaussian sigma for the wash base — higher = looser, more continuous washes" },
  washLevels: { type: RANGE, range: [2, 6], step: 1, default: 4, desc: "Number of discrete ink-dilution bands (deep black, dark, mid, light)" },
  washStrength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "Overall ink density — 0 leaves the paper, 1 saturates darks fully" },
  washSoftness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Smoothness of the band boundaries — 0 hard poster, 1 continuous" },
  edgeThreshold: { type: RANGE, range: [0, 0.8], step: 0.02, default: 0.18, desc: "Sobel gradient cutoff — raise to show fewer, more confident strokes" },
  edgeStrength: { type: RANGE, range: [0, 1.5], step: 0.05, default: 0.5, desc: "Ink intensity of the brush strokes at strong edges" },
  inkColor: { type: COLOR, default: [28, 24, 22], desc: "Ink colour for the darkest washes and brush strokes" },
  paperColor: { type: COLOR, default: [240, 232, 210], desc: "Unpainted paper background colour" },
  grain: { type: RANGE, range: [0, 0.6], step: 0.02, default: 0.12, desc: "Paper texture — flecks of paper showing through the ink" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  brushSoftness: optionTypes.brushSoftness.default,
  washLevels: optionTypes.washLevels.default,
  washStrength: optionTypes.washStrength.default,
  washSoftness: optionTypes.washSoftness.default,
  edgeThreshold: optionTypes.edgeThreshold.default,
  edgeStrength: optionTypes.edgeStrength.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  grain: optionTypes.grain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type SumiEOptions = typeof defaults & { _webglAcceleration?: boolean };

const hash2D = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const sumiE = (input: any, options: SumiEOptions = defaults) => {
  const { brushSoftness, washLevels, washStrength, washSoftness, edgeThreshold, edgeStrength, inkColor, paperColor, grain, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && sumiEGLAvailable()) {
    const rendered = renderSumiEGL(
      input, W, H, brushSoftness, washLevels, washStrength, washSoftness,
      edgeThreshold, edgeStrength, inkColor, paperColor, grain,
    );
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Sumi-e", "WebGL2", `levels=${washLevels} brush=${brushSoftness}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  logFilterWasmStatus("Sumi-e", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // JS reference: separable gaussian → per-pixel wash + Sobel strokes.
  const sigma = Math.max(0.1, brushSoftness);
  const kr = Math.min(32, Math.ceil(sigma * 3));
  const weights: number[] = [];
  let wsum = 0;
  for (let k = -kr; k <= kr; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); weights.push(w); wsum += w; }
  for (let i = 0; i < weights.length; i++) weights[i] /= wsum;

  const tempR = new Float32Array(W * H), tempG = new Float32Array(W * H), tempB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = -kr; k <= kr; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const i = getBufferIndex(nx, y, W);
        const w = weights[k + kr];
        r += buf[i] * w; g += buf[i + 1] * w; b += buf[i + 2] * w;
      }
      const pi = y * W + x;
      tempR[pi] = r; tempG[pi] = g; tempB[pi] = b;
    }

  const blurR = new Float32Array(W * H), blurG = new Float32Array(W * H), blurB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = -kr; k <= kr; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const pi = ny * W + x;
        const w = weights[k + kr];
        r += tempR[pi] * w; g += tempG[pi] * w; b += tempB[pi] * w;
      }
      const pi = y * W + x;
      blurR[pi] = r; blurG[pi] = g; blurB[pi] = b;
    }

  const lumAt = (x: number, y: number) => {
    const i = getBufferIndex(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y)), W);
    return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
  };

  const outBuf = new Uint8ClampedArray(buf.length);
  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const blum = (0.2126 * blurR[pi] + 0.7152 * blurG[pi] + 0.0722 * blurB[pi]) / 255;
      const inverted = Math.max(0, Math.min(1, 1 - blum));
      const band = Math.floor(inverted * washLevels) / washLevels;
      const frac = inverted * washLevels - Math.floor(inverted * washLevels);
      const softEdge = smoothstep(0.5 - washSoftness * 0.5, 0.5 + washSoftness * 0.5, frac);
      const wash = (band + softEdge / washLevels) * washStrength;

      // Sobel
      const a = lumAt(x - 1, y - 1), b = lumAt(x, y - 1), c = lumAt(x + 1, y - 1);
      const d = lumAt(x - 1, y), f = lumAt(x + 1, y);
      const g = lumAt(x - 1, y + 1), h = lumAt(x, y + 1), iv = lumAt(x + 1, y + 1);
      const gx = (c + 2 * f + iv) - (a + 2 * d + g);
      const gy = (g + 2 * h + iv) - (a + 2 * b + c);
      const edgeRaw = Math.sqrt(gx * gx + gy * gy) / 442;
      const edgeInk = smoothstep(edgeThreshold, Math.min(1, edgeThreshold + 0.15), edgeRaw) * edgeStrength;

      let ink = Math.max(wash, edgeInk);
      const n = hash2D(x, y);
      ink = Math.max(0, Math.min(1, ink - (n - 0.5) * grain));

      const i = getBufferIndex(x, y, W);
      outBuf[i] = Math.round(paperColor[0] * (1 - ink) + inkColor[0] * ink);
      outBuf[i + 1] = Math.round(paperColor[1] * (1 - ink) + inkColor[1] * ink);
      outBuf[i + 2] = Math.round(paperColor[2] * (1 - ink) + inkColor[2] * ink);
      outBuf[i + 3] = buf[i + 3];
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  const identity = paletteIsIdentity(palette);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Sumi-e",
  func: sumiE,
  optionTypes,
  options: defaults,
  defaults,
  description: "Japanese ink-wash painting — quantized tonal washes plus strong Sobel brush strokes on paper"
});
