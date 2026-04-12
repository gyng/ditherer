import { RANGE, BOOL, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const COLORMAP = { VIRIDIS: "VIRIDIS", MAGMA: "MAGMA", INFERNO: "INFERNO", GRAYSCALE: "GRAYSCALE" };

// Colormap gradient stops (normalized 0-1 position)
const COLORMAPS: Record<string, number[][]> = {
  [COLORMAP.VIRIDIS]: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  [COLORMAP.MAGMA]: [[0,0,4],[81,18,124],[183,55,121],[252,137,97],[252,253,191]],
  [COLORMAP.INFERNO]: [[0,0,4],[87,16,110],[188,55,84],[249,142,9],[252,255,164]],
  [COLORMAP.GRAYSCALE]: [[0,0,0],[128,128,128],[255,255,255]]
};

const sampleColormap = (stops: number[][], t: number): [number, number, number] => {
  const ct = Math.max(0, Math.min(1, t));
  const pos = ct * (stops.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  if (idx >= stops.length - 1) return [stops[stops.length-1][0], stops[stops.length-1][1], stops[stops.length-1][2]];
  const a = stops[idx], b = stops[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac)
  ];
};

export const optionTypes = {
  colormap: { type: ENUM, options: [
    { name: "Viridis", value: COLORMAP.VIRIDIS },
    { name: "Magma", value: COLORMAP.MAGMA },
    { name: "Inferno", value: COLORMAP.INFERNO },
    { name: "Grayscale", value: COLORMAP.GRAYSCALE }
  ], default: COLORMAP.VIRIDIS, desc: "Color mapping for frequency intensity" },
  logScale: { type: BOOL, default: true, desc: "Use logarithmic frequency scale" },
  freqBins: { type: RANGE, range: [16, 128], step: 8, default: 32, desc: "Number of frequency bands" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  colormap: optionTypes.colormap.default,
  logScale: optionTypes.logScale.default,
  freqBins: optionTypes.freqBins.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const spectrogram = (input, options = defaults) => {
  const { colormap, logScale, freqBins, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const stops = COLORMAPS[colormap] || COLORMAPS[COLORMAP.VIRIDIS];
  const numBins = Math.min(freqBins, H);

  // Per-column simplified DFT
  for (let x = 0; x < W; x++) {
    // Extract luminance column
    const col = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const i = getBufferIndex(x, y, W);
      col[y] = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    }

    // DFT for first numBins frequencies
    const magnitudes = new Float32Array(numBins);
    let maxMag = 0;
    for (let k = 0; k < numBins; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < H; n++) {
        const angle = (2 * Math.PI * k * n) / H;
        re += col[n] * Math.cos(angle);
        im -= col[n] * Math.sin(angle);
      }
      let mag = Math.sqrt(re * re + im * im) / H;
      if (logScale) mag = Math.log10(1 + mag * 100);
      magnitudes[k] = mag;
      if (mag > maxMag) maxMag = mag;
    }

    // Normalize and render
    for (let y = 0; y < H; y++) {
      const bin = Math.floor((y / H) * numBins);
      const t = maxMag > 0 ? magnitudes[bin] / maxMag : 0;
      const [cr, cg, cb] = sampleColormap(stops, t);

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(cr, cg, cb, 255), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Spectrogram", func: spectrogram, optionTypes, options: defaults, defaults });
