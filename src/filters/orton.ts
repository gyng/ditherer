import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { ortonGLAvailable, renderOrtonGL } from "./ortonGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 40], step: 1, default: 12, desc: "Gaussian blur sigma for the glow copy" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Opacity of the dreamy screen-blended glow" },
  contrast: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Midtone contrast lift after the screen blend washes things out" },
  saturation: { type: RANGE, range: [0, 2], step: 0.05, default: 1.2, desc: "Saturation multiplier — Orton looks lean a little warmer/richer" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  saturation: optionTypes.saturation.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type OrtonOptions = typeof defaults & { _webglAcceleration?: boolean };

const orton = (input: any, options: OrtonOptions = defaults) => {
  const { radius, strength, contrast, saturation, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && ortonGLAvailable()) {
    const rendered = renderOrtonGL(input, W, H, radius, strength, contrast, saturation);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Orton", "WebGL2", `radius=${radius} strength=${strength}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  logFilterWasmStatus("Orton", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Separable gaussian (JS reference path).
  const sigma = radius, kr = Math.min(60, Math.ceil(sigma * 3));
  const tempR = new Float32Array(W * H), tempG = new Float32Array(W * H), tempB = new Float32Array(W * H);
  const weights: number[] = [];
  let wsum = 0;
  for (let k = -kr; k <= kr; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); weights.push(w); wsum += w; }
  for (let i = 0; i < weights.length; i++) weights[i] /= wsum;

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -kr; k <= kr; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const i = getBufferIndex(nx, y, W);
        const w = weights[k + kr];
        sr += buf[i] * w; sg += buf[i + 1] * w; sb += buf[i + 2] * w;
      }
      const pi = y * W + x;
      tempR[pi] = sr; tempG[pi] = sg; tempB[pi] = sb;
    }

  const blurR = new Float32Array(W * H), blurG = new Float32Array(W * H), blurB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -kr; k <= kr; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const pi = ny * W + x;
        const w = weights[k + kr];
        sr += tempR[pi] * w; sg += tempG[pi] * w; sb += tempB[pi] * w;
      }
      const pi = y * W + x;
      blurR[pi] = sr; blurG[pi] = sg; blurB[pi] = sb;
    }

  const outBuf = new Uint8ClampedArray(buf.length);
  const composite = (s: number, b: number) => {
    const sn = s / 255, bn = b / 255;
    const screen = 1 - (1 - sn) * (1 - bn);
    let m = sn * (1 - strength) + screen * strength;
    m = (m - 0.5) * (1 + contrast) + 0.5;
    return m;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const pi = y * W + x;
      let r = composite(buf[i], blurR[pi]);
      let g = composite(buf[i + 1], blurG[pi]);
      let b = composite(buf[i + 2], blurB[pi]);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;
      outBuf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      outBuf[i + 3] = buf[i + 3];
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  const identity = paletteIsIdentity(palette);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Orton",
  func: orton,
  optionTypes,
  options: defaults,
  defaults,
  description: "Dreamy diffusion glow — screen-blends a gaussian-blurred copy over the source for a soft, painterly photo look"
});
