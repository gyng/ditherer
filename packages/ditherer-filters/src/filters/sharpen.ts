import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  logFilterBackend,
} from "../utils/index";
import { normalizeRangeOption } from "../utils/filterOptions";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { gaussianKernel1D } from "./opticalConvolutionContracts";
import { sharpenGLAvailable, renderSharpenGL } from "./sharpenGL";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 5], step: 0.1, default: 1.5, desc: "Sharpening intensity applied via unsharp mask" },
  radius: { type: RANGE, range: [1, 20], step: 1, default: 3, desc: "Blur radius for the unsharp mask kernel" },
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 0, desc: "Minimum difference required to sharpen a pixel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const sharpenFilter = (input: any, options: Partial<typeof defaults> = defaults) => {
  const strength = normalizeRangeOption(options.strength, defaults.strength, 0, 5);
  const radius = normalizeRangeOption(options.radius, defaults.radius, 1, 20, true);
  const threshold = normalizeRangeOption(options.threshold, defaults.threshold, 0, 50);
  const palette = options.palette ?? defaults.palette;
  const W = input.width;
  const H = input.height;

  if (
    sharpenGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256) : 256;
    const rendered = renderSharpenGL(input, W, H, strength, radius, threshold, levels);
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Sharpen", "WebGL2", `strength=${strength} radius=${radius}${isNearest ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Separable Gaussian blur (the low-pass that defines the unsharp mask).
  const kernel = gaussianKernel1D(radius);
  const blurH = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        const w = kernel[kx + radius];
        const nx = Math.max(0, Math.min(W - 1, x + kx));
        const i = getBufferIndex(nx, y, W);
        sr += buf[i] * w;
        sg += buf[i + 1] * w;
        sb += buf[i + 2] * w;
      }
      const idx = (y * W + x) * 3;
      blurH[idx] = sr;
      blurH[idx + 1] = sg;
      blurH[idx + 2] = sb;
    }
  }

  const blurred = new Float32Array(W * H * 3);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let sr = 0, sg = 0, sb = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const w = kernel[ky + radius];
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        const idx = (ny * W + x) * 3;
        sr += blurH[idx] * w;
        sg += blurH[idx + 1] * w;
        sb += blurH[idx + 2] * w;
      }
      const idx = (y * W + x) * 3;
      blurred[idx] = sr;
      blurred[idx + 1] = sg;
      blurred[idx + 2] = sb;
    }
  }

  // Unsharp mask: output = original + (original - blurred) * strength, gated
  // by the threshold. Write raw pixels and quantize once at the end so a
  // custom palette applies uniformly (previously the kept branch skipped it,
  // diverging from the GL path and posterizing only the sharpened pixels).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const bIdx = (y * W + x) * 3;
      const dr = buf[i] - blurred[bIdx];
      const dg = buf[i + 1] - blurred[bIdx + 1];
      const db = buf[i + 2] - blurred[bIdx + 2];

      const diff = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      if (diff < threshold * 3) {
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        continue;
      }

      const r = Math.max(0, Math.min(255, Math.round(buf[i] + dr * strength)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] + dg * strength)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] + db * strength)));
      fillBufferPixel(outBuf, i, r, g, b, buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  const identity = paletteIsIdentity(palette);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Sharpen",
  func: sharpenFilter,
  optionTypes,
  options: defaults,
  defaults
});
