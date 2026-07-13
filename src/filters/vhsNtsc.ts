import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderVHSNTSCGL } from "./vhsNtscGL";

export const optionTypes = {
  tapeSpeed: {
    type: ENUM,
    options: [
      { name: "SP (best quality)", value: "SP" },
      { name: "LP", value: "LP" },
      { name: "EP / SLP (softest)", value: "EP" },
      { name: "Composite only", value: "NONE" },
    ],
    default: "LP",
    desc: "VHS recording speed; slower modes reduce luma/chroma bandwidth and increase color delay",
  },
  fieldMode: {
    type: ENUM,
    options: [
      { name: "Interleaved", value: "INTERLEAVED" },
      { name: "Both / progressive", value: "BOTH" },
      { name: "Upper field", value: "UPPER" },
      { name: "Lower field", value: "LOWER" },
    ],
    default: "INTERLEAVED",
    desc: "How scanline fields drive carrier phase and source-line selection",
  },
  filterType: {
    type: ENUM,
    options: [
      { name: "Butterworth (sharper)", value: "BUTTERWORTH" },
      { name: "Constant K (blurrier)", value: "CONSTANT_K" },
    ],
    default: "BUTTERWORTH",
    desc: "Shape of the luma and chroma bandwidth filters",
  },
  demodulation: {
    type: ENUM,
    options: [
      { name: "Notch", value: "NOTCH" },
      { name: "One-line comb", value: "ONE_LINE_COMB" },
      { name: "Two-line comb", value: "TWO_LINE_COMB" },
    ],
    default: "NOTCH",
    desc: "NTSC luma/chroma separation method; comb filters suppress dot crawl at the cost of vertical blending",
  },
  compositeSharpness: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Pre-emphasis applied before composite modulation" },
  compositeNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.05, desc: "Noise injected into the modulated composite waveform" },
  snow: { type: RANGE, range: [0, 0.1], step: 0.00025, default: 0.00025, desc: "Sparse RF transients and white speckles" },
  snowAnisotropy: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Clump snow into horizontal tape lines" },
  headSwitching: { type: RANGE, range: [0, 160], step: 1, default: 72, desc: "Horizontal displacement in the bottom head-switching band" },
  headSwitchingHeight: { type: RANGE, range: [0, 64], step: 1, default: 8, desc: "Height of the bottom head-switching band" },
  trackingNoise: { type: RANGE, range: [0, 60], step: 1, default: 15, desc: "Wavy time-base error near the bottom of the image" },
  trackingHeight: { type: RANGE, range: [0, 96], step: 1, default: 12, desc: "Height of the tracking disturbance region" },
  edgeWave: { type: RANGE, range: [0, 8], step: 0.1, default: 0.5, desc: "Slow whole-frame VHS edge waviness" },
  lumaSmear: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Asymmetric horizontal luminance smear" },
  tapeSharpness: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "ntsc-rs VHS luma sharpen stage, applied after tape filtering and chroma loss" },
  ringing: { type: RANGE, range: [0, 8], step: 0.1, default: 4, desc: "ntsc-rs ringing intensity applied through a calibrated notch filter" },
  ringingFrequency: { type: RANGE, range: [0, 1], step: 0.01, default: 0.45, desc: "Normalized frequency of the ntsc-rs luma ringing notch" },
  ringingPower: { type: RANGE, range: [0.25, 8], step: 0.25, default: 4, desc: "Quality factor (power) of the ntsc-rs luma ringing notch" },
  lumaNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.01, desc: "Noise added after luma demodulation" },
  chromaNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Low-frequency noise in the decoded color signal" },
  chromaPhaseNoise: { type: RANGE, range: [0, 1], step: 0.001, default: 0.001, desc: "Random per-line hue flutter from chroma carrier timing error" },
  chromaPhaseError: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Constant chroma phase error, expressed as a half-turn" },
  chromaDelayH: { type: RANGE, range: [-12, 12], step: 0.5, default: 0, desc: "Additional horizontal chroma delay in pixels" },
  chromaDelayV: { type: RANGE, range: [-4, 4], step: 1, default: 0, desc: "Additional vertical chroma delay in scanlines" },
  chromaLoss: { type: RANGE, range: [0, 0.25], step: 0.000025, default: 0.000025, desc: "Probability that a scanline loses all color" },
  chromaVertBlend: { type: BOOL, default: true, desc: "Blend each chroma scanline with the preceding line as VHS does" },
  randomSeed: { type: RANGE, range: [0, 9999], step: 1, default: 0, desc: "Deterministic noise and defect seed" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Preview animation frame rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
      }
    },
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  tapeSpeed: optionTypes.tapeSpeed.default,
  fieldMode: optionTypes.fieldMode.default,
  filterType: optionTypes.filterType.default,
  demodulation: optionTypes.demodulation.default,
  compositeSharpness: optionTypes.compositeSharpness.default,
  compositeNoise: optionTypes.compositeNoise.default,
  snow: optionTypes.snow.default,
  snowAnisotropy: optionTypes.snowAnisotropy.default,
  headSwitching: optionTypes.headSwitching.default,
  headSwitchingHeight: optionTypes.headSwitchingHeight.default,
  trackingNoise: optionTypes.trackingNoise.default,
  trackingHeight: optionTypes.trackingHeight.default,
  edgeWave: optionTypes.edgeWave.default,
  lumaSmear: optionTypes.lumaSmear.default,
  tapeSharpness: optionTypes.tapeSharpness.default,
  ringing: optionTypes.ringing.default,
  ringingFrequency: optionTypes.ringingFrequency.default,
  ringingPower: optionTypes.ringingPower.default,
  lumaNoise: optionTypes.lumaNoise.default,
  chromaNoise: optionTypes.chromaNoise.default,
  chromaPhaseNoise: optionTypes.chromaPhaseNoise.default,
  chromaPhaseError: optionTypes.chromaPhaseError.default,
  chromaDelayH: optionTypes.chromaDelayH.default,
  chromaDelayV: optionTypes.chromaDelayV.default,
  chromaLoss: optionTypes.chromaLoss.default,
  chromaVertBlend: optionTypes.chromaVertBlend.default,
  randomSeed: optionTypes.randomSeed.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const FIELD_MODE: Record<string, number> = {
  INTERLEAVED: 0,
  BOTH: 1,
  UPPER: 2,
  LOWER: 3,
};

const FILTER_TYPE: Record<string, number> = {
  BUTTERWORTH: 0,
  CONSTANT_K: 1,
};

const DEMODULATION: Record<string, number> = {
  NOTCH: 0,
  ONE_LINE_COMB: 1,
  TWO_LINE_COMB: 2,
};

const TAPE_PROFILE: Record<string, { id: number; lumaRadius: number; chromaRadius: number; chromaDelay: number }> = {
  NONE: { id: 0, lumaRadius: 0, chromaRadius: 0, chromaDelay: 0 },
  SP: { id: 1, lumaRadius: 1, chromaRadius: 4, chromaDelay: 4 },
  LP: { id: 2, lumaRadius: 2, chromaRadius: 6, chromaDelay: 5 },
  EP: { id: 3, lumaRadius: 3, chromaRadius: 8, chromaDelay: 6 },
};

type VHSNTSCOptions = typeof defaults & { _frameIndex?: number };

const vhsNtsc = (
  input: HTMLCanvasElement | OffscreenCanvas,
  options: VHSNTSCOptions = defaults,
) => {
  const width = input.width;
  const height = input.height;
  const tape = TAPE_PROFILE[options.tapeSpeed] ?? TAPE_PROFILE.LP;
  const frame = Number(options._frameIndex ?? 0);

  const rendered = renderVHSNTSCGL(input, width, height, {
    frame,
    seed: options.randomSeed,
    fieldMode: FIELD_MODE[options.fieldMode] ?? FIELD_MODE.INTERLEAVED,
    filterType: FILTER_TYPE[options.filterType] ?? FILTER_TYPE.BUTTERWORTH,
    demodulation: DEMODULATION[options.demodulation] ?? DEMODULATION.NOTCH,
    tapeSpeed: tape.id,
    lumaRadius: tape.lumaRadius,
    chromaRadius: tape.chromaRadius,
    tapeChromaDelay: tape.chromaDelay,
    compositeSharpness: options.compositeSharpness,
    compositeNoise: options.compositeNoise,
    snow: options.snow,
    snowAnisotropy: options.snowAnisotropy,
    headSwitching: options.headSwitching,
    headSwitchingHeight: options.headSwitchingHeight,
    trackingNoise: options.trackingNoise,
    trackingHeight: options.trackingHeight,
    edgeWave: options.edgeWave,
    chromaDelayH: options.chromaDelayH,
    chromaDelayV: options.chromaDelayV,
    chromaVertBlend: options.chromaVertBlend,
    chromaLoss: options.chromaLoss,
    chromaPhaseNoise: options.chromaPhaseNoise,
    chromaPhaseError: options.chromaPhaseError,
    lumaSmear: options.lumaSmear,
    // Saved chains created before the conformance port do not contain this
    // option. Never allow a missing legacy value to become a NaN FIR kernel.
    tapeSharpness: Number.isFinite(options.tapeSharpness)
      ? options.tapeSharpness
      : defaults.tapeSharpness,
    ringing: options.ringing,
    ringingFrequency: Number.isFinite(options.ringingFrequency)
      ? options.ringingFrequency
      : defaults.ringingFrequency,
    ringingPower: Number.isFinite(options.ringingPower)
      ? options.ringingPower
      : defaults.ringingPower,
    lumaNoise: options.lumaNoise,
    chromaNoise: options.chromaNoise,
  });
  if (!rendered) return input;

  const identity = paletteIsIdentity(options.palette);
  const output = identity
    ? rendered
    : applyPalettePassToCanvas(rendered, width, height, options.palette);
  logFilterBackend(
    "VHS / NTSC",
    "WebGL2",
    `${options.tapeSpeed}+${options.demodulation}${identity ? "" : "+palettePass"}`,
  );
  return output ?? input;
};

export default defineFilter({
  name: "VHS / NTSC",
  func: vhsNtsc,
  options: defaults,
  optionTypes,
  defaults,
  temporal: true,
  requiresGL: true,
});
