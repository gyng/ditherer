import { ACTION, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { renderVintageTVGL } from "./vintageTVGL";

const SYSTEM = { NTSC: "NTSC", PAL: "PAL" } as const;

export const optionTypes = {
  system: {
    type: ENUM,
    options: [
      { name: "525/59.94 receiver", value: SYSTEM.NTSC },
      { name: "625/50 receiver", value: SYSTEM.PAL },
    ],
    default: SYSTEM.NTSC,
    desc: "Analogue raster family used for field-rate motion and visible line structure",
  },
  banding: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Low-frequency power/interference hum added to decoded luminance" },
  colorFringe: { type: RANGE, range: [0, 10], step: 0.5, default: 2, desc: "Horizontal chroma delay relative to the luminance signal in pixels" },
  chromaBandwidth: { type: RANGE, range: [0, 10], step: 1, default: 4, desc: "Horizontal chroma low-pass radius; analogue color is softer than luminance" },
  tuningError: { type: RANGE, range: [-30, 30], step: 1, default: 2, desc: "Chrominance phase error that rotates hue during receiver decoding" },
  verticalRoll: { type: RANGE, range: [0, 20], step: 0.5, default: 2, desc: "Peak vertical-hold displacement in output pixels" },
  scanlineStrength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.28, desc: "Visibility of the interlaced CRT field raster when output resolution can resolve it" },
  glow: { type: RANGE, range: [0, 1], step: 0.01, default: 0.22, desc: "Linear-light optical bloom around bright phosphor detail" },
  rfNoise: { type: RANGE, range: [0, 0.3], step: 0.005, default: 0.018, desc: "Frame-varying receiver noise added to the luminance channel" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Playback rate for receiver noise and vertical-hold motion" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop receiver noise, hum drift, and vertical-hold motion",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette applied after analogue decoding and CRT display" },
};

export const defaults = {
  system: optionTypes.system.default,
  banding: optionTypes.banding.default,
  colorFringe: optionTypes.colorFringe.default,
  chromaBandwidth: optionTypes.chromaBandwidth.default,
  tuningError: optionTypes.tuningError.default,
  verticalRoll: optionTypes.verticalRoll.default,
  scanlineStrength: optionTypes.scanlineStrength.default,
  glow: optionTypes.glow.default,
  rfNoise: optionTypes.rfNoise.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const bounded = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

type VintageTVOptions = {
  system?: string;
  banding?: number;
  colorFringe?: number;
  chromaBandwidth?: number;
  tuningError?: number;
  verticalRoll?: number;
  scanlineStrength?: number;
  glow?: number;
  rfNoise?: number;
  animSpeed?: number;
  palette?: typeof defaults.palette;
  _frameIndex?: number;
};

const vintageTV = (
  input: HTMLCanvasElement | OffscreenCanvas,
  options: VintageTVOptions = defaults,
) => {
  const width = input.width;
  const height = input.height;
  const system = options.system === SYSTEM.PAL ? SYSTEM.PAL : SYSTEM.NTSC;
  const banding = bounded(options.banding, defaults.banding, 0, 1);
  const colorFringe = bounded(options.colorFringe, defaults.colorFringe, 0, 10);
  const chromaBandwidth = Math.round(bounded(options.chromaBandwidth, defaults.chromaBandwidth, 0, 10));
  const tuningError = bounded(options.tuningError, defaults.tuningError, -30, 30);
  const verticalRoll = bounded(options.verticalRoll, defaults.verticalRoll, 0, 20);
  const scanlineStrength = bounded(options.scanlineStrength, defaults.scanlineStrength, 0, 1);
  const glow = bounded(options.glow, defaults.glow, 0, 1);
  const rfNoise = bounded(options.rfNoise, defaults.rfNoise, 0, 0.3);
  const frameIndex = bounded(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER);
  const fieldRate = system === SYSTEM.PAL ? 50 : 59.94;
  const fieldLines = system === SYSTEM.PAL ? 288 : 240;
  const rollOffset = verticalRoll * Math.sin(frameIndex * (system === SYSTEM.PAL ? 0.083 : 0.1));
  const palette = options.palette ?? defaults.palette;
  const rendered = renderVintageTVGL(input, width, height, {
    banding,
    colorFringe,
    chromaBandwidth,
    tuningError,
    rollOffset,
    frameIndex,
    fieldRate,
    fieldLines,
    scanlineStrength,
    glow,
    rfNoise,
  });
  if (!rendered) return input;
  const identityPalette = paletteIsIdentity(palette);
  const output = identityPalette ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend("Vintage TV", "WebGL2", `${system} chromaR=${chromaBandwidth}${identityPalette ? "" : "+palettePass"}`);
  return output ?? input;
};

export default defineFilter({
  name: "Vintage TV",
  func: vintageTV,
  options: defaults,
  optionTypes,
  defaults,
  description: "Conventional 525/625-line receiver proxy with luma/chroma bandwidth separation, chroma phase error, vertical hold, interlaced raster, RF hum, and phosphor bloom",
  temporal: true,
  requiresGL: true,
});
