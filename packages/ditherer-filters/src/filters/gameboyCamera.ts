import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderGameboyCameraGL } from "./gameboyCameraGL";

const previewRate = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Math.max(1, Math.min(30, Number.isFinite(numeric) ? numeric : fallback));
};

export const optionTypes = {
  resolution: { type: RANGE, range: [64, 256], step: 1, default: 128, desc: "Horizontal sensor sample count; 128 is the M64282FP nominal width" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.8, desc: "Contrast boost before quantization" },
  exposure: { type: RANGE, range: [0.1, 4], step: 0.05, default: 1, desc: "M64282FP C0/C1 electronic exposure time relative to nominal" },
  gain: { type: RANGE, range: [0.25, 4], step: 0.05, default: 1, desc: "M64282FP G gain, applied after the edge-processing stage" },
  bias: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "M64282FP V/O output-level offset, applied after edge processing" },
  invertSensor: { type: BOOL, default: false, desc: "M64282FP I register signal inversion" },
  edgeMode: {
    type: ENUM,
    options: [
      { name: "Horizontal + vertical", value: "HV" },
      { name: "Horizontal", value: "H" },
      { name: "Vertical", value: "V" },
      { name: "Disabled", value: "OFF" },
    ],
    default: "HV",
    desc: "M64282FP N/VH edge-extraction direction",
  },
  edgeEnhance: { type: RANGE, range: [0, 2], step: 0.05, default: 0.8, desc: "M64282FP E edge-output ratio" },
  kernelP: { type: RANGE, range: [-2, 2], step: 0.05, default: -0.25, desc: "M64282FP P coefficient of the programmable 1-D filter" },
  kernelM: { type: RANGE, range: [-2, 2], step: 0.05, default: 1.5, desc: "M64282FP M center coefficient of the programmable 1-D filter" },
  kernelX: { type: RANGE, range: [-2, 2], step: 0.05, default: -0.25, desc: "M64282FP X coefficient of the programmable 1-D filter" },
  sensorNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.06, desc: "Frame-varying M64282FP analogue read noise" },
  randomSeed: { type: RANGE, range: [0, 9999], step: 1, default: 6428, desc: "Deterministic sensor-noise seed" },
  ditherStrength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Strength of the cartridge controller's 4x4, three-threshold matrix" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10, desc: "Preview sensor frame rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Advance preview frames",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, previewRate(options.animSpeed, 10)); }
    }
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  contrast: optionTypes.contrast.default,
  exposure: optionTypes.exposure.default,
  gain: optionTypes.gain.default,
  bias: optionTypes.bias.default,
  invertSensor: optionTypes.invertSensor.default,
  edgeMode: optionTypes.edgeMode.default,
  edgeEnhance: optionTypes.edgeEnhance.default,
  kernelP: optionTypes.kernelP.default,
  kernelM: optionTypes.kernelM.default,
  kernelX: optionTypes.kernelX.default,
  sensorNoise: optionTypes.sensorNoise.default,
  randomSeed: optionTypes.randomSeed.default,
  ditherStrength: optionTypes.ditherStrength.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 4 } }
};

type GameboyCameraOptions = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

const finiteClamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const numeric = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(numeric) ? numeric : fallback));
};

/** The cartridge discards eight rows at each end of the 128x128 sensor transfer. */
export const resolveGameboySensorGrid = (requestedResolution: unknown): { width: number; height: number } => {
  const width = Math.round(finiteClamp(requestedResolution, defaults.resolution, 64, 256));
  return { width, height: Math.max(1, Math.round(width * 112 / 128)) };
};

const gameboyCamera = (input: any, options: GameboyCameraOptions = defaults) => {
  const W = input.width, H = input.height;
  if (W < 1 || H < 1) return input;
  const resolution = Math.round(finiteClamp(options.resolution, defaults.resolution, 64, 256));
  const contrast = finiteClamp(options.contrast, defaults.contrast, 0.5, 3);
  const edgeEnhance = finiteClamp(options.edgeEnhance, defaults.edgeEnhance, 0, 2);
  const ditherStrength = finiteClamp(options.ditherStrength, defaults.ditherStrength, 0, 1);
  const palette = options.palette ?? defaults.palette;
  // The sensor transfers 128x128 samples; the cartridge controller ignores the
  // first and last eight rows, yielding its documented 128x112 image.
  const { width: downW, height: downH } = resolveGameboySensorGrid(resolution);
  const requestedEdgeMode = String(options.edgeMode);
  const edgeModeName = ["OFF", "H", "V", "HV"].includes(requestedEdgeMode)
    ? requestedEdgeMode
    : defaults.edgeMode;
  const edgeMode = { OFF: 0, H: 1, V: 2, HV: 3 }[edgeModeName] ?? 3;
  const rendered = renderGameboyCameraGL(input, W, H, downW, downH, {
    contrast,
    exposure: finiteClamp(options.exposure, defaults.exposure, 0.1, 4),
    gain: finiteClamp(options.gain, defaults.gain, 0.25, 4),
    bias: finiteClamp(options.bias, defaults.bias, -1, 1),
    invert: options.invertSensor === true ? 1 : 0,
    edgeMode,
    edgeEnhance,
    kernelP: finiteClamp(options.kernelP, defaults.kernelP, -2, 2),
    kernelM: finiteClamp(options.kernelM, defaults.kernelM, -2, 2),
    kernelX: finiteClamp(options.kernelX, defaults.kernelX, -2, 2),
    sensorNoise: finiteClamp(options.sensorNoise, defaults.sensorNoise, 0, 1),
    randomSeed: finiteClamp(options.randomSeed, defaults.randomSeed, 0, 9999),
    frame: Math.floor(finiteClamp(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER)),
    ditherStrength,
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Gameboy Camera", "WebGL2", `M64282FP ${downW}x${downH} edge=${edgeModeName}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Gameboy Camera",
  func: gameboyCamera,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
  temporal: true,
  description: "Mitsubishi M64282FP sensor register model with cartridge four-tone dithering",
});
