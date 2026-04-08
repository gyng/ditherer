import { BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  perChannel: { type: BOOL, default: false },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  perChannel: optionTypes.perChannel.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const buildCdf = (hist: number[], total: number): number[] => {
  const cdf: number[] = new Array(256).fill(0);
  let cumulative = 0;
  let cdfMin = -1;
  for (let i = 0; i < 256; i += 1) {
    cumulative += hist[i];
    cdf[i] = cumulative;
    if (cdfMin < 0 && cumulative > 0) cdfMin = cumulative;
  }
  // Normalize: map cdf value to 0-255
  const range = total - cdfMin;
  return cdf.map(v => (range > 0 ? Math.round(((v - cdfMin) / range) * 255) : 0));
};

const histogramEqualization = (input, options = defaults) => {
  const { perChannel, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const total = W * H;

  let mapR: number[], mapG: number[], mapB: number[];

  if (perChannel) {
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    for (let i = 0; i < buf.length; i += 4) {
      histR[buf[i]] += 1;
      histG[buf[i + 1]] += 1;
      histB[buf[i + 2]] += 1;
    }
    mapR = buildCdf(histR, total);
    mapG = buildCdf(histG, total);
    mapB = buildCdf(histB, total);
  } else {
    // Equalize luminance channel only, preserve hue
    const histL = new Array(256).fill(0);
    for (let i = 0; i < buf.length; i += 4) {
      const lum = Math.round(buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722);
      histL[lum] += 1;
    }
    const cdfL = buildCdf(histL, total);
    // Store as shared map (applied via luminance scaling below)
    mapR = mapG = mapB = cdfL;
  }

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      let r: number, g: number, b: number;

      if (perChannel) {
        r = mapR[buf[i]];
        g = mapG[buf[i + 1]];
        b = mapB[buf[i + 2]];
      } else {
        const lum = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
        const lumIdx = Math.round(lum);
        const scale = lum > 0 ? mapR[lumIdx] / lum : 1;
        r = Math.min(255, Math.round(buf[i] * scale));
        g = Math.min(255, Math.round(buf[i + 1] * scale));
        b = Math.min(255, Math.round(buf[i + 2] * scale));
      }

      const col = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Histogram equalization",
  func: histogramEqualization,
  options: defaults,
  optionTypes,
  defaults
};
