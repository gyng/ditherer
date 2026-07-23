import { RANGE, BOOL, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor, logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import { defineFilter } from "./types";
import {
  SPECTROGRAM_GL_MAX_SIGNAL_LENGTH,
  spectrogramGLAvailable,
  renderSpectrogramGL,
} from "./spectrogramGL";
import {
  hannWindow,
  spectrogramBinForRow,
  spectrogramMagnitudeLevel,
  spectrogramNyquistBinCount,
} from "./displaySpectrumContracts";
import {
  normalizeBooleanOption,
  normalizeEnumOption,
  normalizePaletteOption,
  normalizeRangeOption,
} from "../utils/filterOptions";

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
  logScale: { type: BOOL, default: true, desc: "Space the displayed frequency axis logarithmically" },
  freqBins: { type: RANGE, range: [16, 128], step: 8, default: 64, desc: "Requested one-sided frequency bins, capped at Nyquist" },
  dynamicRange: { type: RANGE, range: [20, 100], step: 1, default: 60, desc: "Shared decibel range from the strongest representable magnitude" },
  palette: { type: PALETTE, default: nearest, desc: "Optional final palette mapping after the scientific colormap" }
};

export const defaults = {
  colormap: optionTypes.colormap.default,
  logScale: optionTypes.logScale.default,
  freqBins: optionTypes.freqBins.default,
  dynamicRange: optionTypes.dynamicRange.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type SpectrogramOptions = Partial<typeof defaults> & { _webglAcceleration?: boolean };

const spectrogram = (input: any, options: SpectrogramOptions = defaults) => {
  const supplied = { ...defaults, ...options };
  const resolved = {
    ...supplied,
    colormap: normalizeEnumOption(
      supplied.colormap,
      [COLORMAP.VIRIDIS, COLORMAP.MAGMA, COLORMAP.INFERNO, COLORMAP.GRAYSCALE],
      defaults.colormap,
    ),
    logScale: normalizeBooleanOption(supplied.logScale, defaults.logScale),
    freqBins: normalizeRangeOption(supplied.freqBins, defaults.freqBins, 16, 128, true),
    dynamicRange: normalizeRangeOption(supplied.dynamicRange, defaults.dynamicRange, 20, 100),
    palette: normalizePaletteOption(supplied.palette, defaults.palette),
  };
  const { colormap, logScale, freqBins, dynamicRange, palette } = resolved;
  const W = input.width, H = input.height;

  const stops = COLORMAPS[colormap] || COLORMAPS[COLORMAP.VIRIDIS];
  const numBins = spectrogramNyquistBinCount(H, freqBins);

  if (
    spectrogramGLAvailable()
    && H <= SPECTROGRAM_GL_MAX_SIGNAL_LENGTH
    && resolved._webglAcceleration !== false
  ) {
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256) : 256;
    const rendered = renderSpectrogramGL(input, W, H, numBins, logScale, dynamicRange, stops, levels);
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Spectrogram", "WebGL2",
          `${colormap} bins=${numBins} log=${logScale}${isNearest ? "" : "+palettePass"}`);
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

  const window = new Float32Array(H);
  let windowSum = 0;
  for (let y = 0; y < H; y += 1) {
    window[y] = hannWindow(y, H);
    windowSum += window[y];
  }

  // Treat each image column as a windowed one-dimensional spatial signal.
  for (let x = 0; x < W; x++) {
    // Extract luminance column
    const col = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const i = getBufferIndex(x, y, W);
      col[y] = ((0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255)
        * (buf[i + 3] / 255);
    }

    // DFT for first numBins frequencies
    const magnitudes = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < H; n++) {
        const angle = (2 * Math.PI * k * n) / H;
        const sample = col[n] * window[n];
        re += sample * Math.cos(angle);
        im -= sample * Math.sin(angle);
      }
      magnitudes[k] = spectrogramMagnitudeLevel(re, im, windowSum, k, H, dynamicRange);
    }

    // Render against one shared absolute dB reference. LogScale changes only
    // frequency-axis spacing; it no longer renormalizes each time column.
    for (let y = 0; y < H; y++) {
      const bin = spectrogramBinForRow(y, H, numBins, logScale);
      const t = magnitudes[bin];
      const [cr, cg, cb] = sampleColormap(stops, t);

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(cr, cg, cb, buf[di + 3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[di + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Spectrogram",
  func: spectrogram,
  optionTypes,
  options: defaults,
  defaults,
  description: "Spatial-frequency spectrogram treating each image column as a Hann-windowed signal with fixed-reference dB magnitude and linear or log frequency spacing",
});
