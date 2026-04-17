import { ACTION, BOOL, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

const SOURCE = {
  EMA: "EMA",
  PREVIOUS_FRAME: "PREVIOUS_FRAME",
};

let energyMap: Float32Array | null = null;
let energyWidth = 0;
let energyHeight = 0;
let lastFrameIndex = -1;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const resetEnergy = (width: number, height: number) => {
  energyMap = new Float32Array(width * height);
  energyWidth = width;
  energyHeight = height;
};

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "EMA background", value: SOURCE.EMA },
      { name: "Previous frame", value: SOURCE.PREVIOUS_FRAME },
    ],
    default: SOURCE.EMA,
    desc: "Compare against the running background model or just the previous frame",
  },
  depth: { type: RANGE, range: [0.5, 8], step: 0.5, default: 3, desc: "How strongly temporal changes emboss the surface shading" },
  decay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.08, desc: "How quickly old change history relaxes out of the relief map" },
  lightAngle: { type: RANGE, range: [0, 360], step: 5, default: 45, desc: "Direction of the relighting used for the embossed temporal surface" },
  invert: { type: BOOL, default: false, desc: "Flip raised and recessed motion structure" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  source: optionTypes.source.default,
  depth: optionTypes.depth.default,
  decay: optionTypes.decay.default,
  lightAngle: optionTypes.lightAngle.default,
  invert: optionTypes.invert.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalReliefOptions = FilterOptionValues & {
  source?: string;
  depth?: number;
  decay?: number;
  lightAngle?: number;
  invert?: boolean;
  animSpeed?: number;
  _frameIndex?: number;
  _prevInput?: Uint8ClampedArray | null;
  _ema?: Float32Array | null;
};

const temporalRelief = (input: any, options: TemporalReliefOptions = defaults) => {
  const sourceMode = options.source ?? defaults.source;
  const depth = Number(options.depth ?? defaults.depth);
  const decay = clamp01(Number(options.decay ?? defaults.decay));
  const lightAngle = Number(options.lightAngle ?? defaults.lightAngle) * Math.PI / 180;
  const invert = Boolean(options.invert ?? defaults.invert);
  const frameIndex = Number(options._frameIndex ?? 0);

  const reference: Float32Array | Uint8ClampedArray | null = sourceMode === SOURCE.PREVIOUS_FRAME
    ? (options._prevInput ?? null)
    : (options._ema ?? null);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const source = inputCtx.getImageData(0, 0, width, height).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;

  if (!energyMap || energyWidth !== width || energyHeight !== height || restartedAnimation) {
    resetEnergy(width, height);
  }
  lastFrameIndex = frameIndex;

  for (let i = 0; i < source.length; i += 4) {
    const pixelIndex = i >> 2;
    const diff = reference
      ? (Math.abs(source[i] - reference[i]) + Math.abs(source[i + 1] - reference[i + 1]) + Math.abs(source[i + 2] - reference[i + 2])) / 765
      : 0;
    energyMap![pixelIndex] = Math.max(diff, energyMap![pixelIndex] * (1 - decay));
  }

  const outBuf = new Uint8ClampedArray(source.length);
  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);
  const depthSign = invert ? -depth : depth;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const i = pixelIndex * 4;
      const left = energyMap![y * width + Math.max(0, x - 1)];
      const right = energyMap![y * width + Math.min(width - 1, x + 1)];
      const up = energyMap![Math.max(0, y - 1) * width + x];
      const down = energyMap![Math.min(height - 1, y + 1) * width + x];
      const center = energyMap![pixelIndex];

      const gx = right - left;
      const gy = down - up;
      const shade = clamp01(0.5 + (gx * lightX + gy * lightY) * depthSign + center * 0.35);
      const baseLuma = (0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2]) / 255;
      const relief = clamp01(baseLuma * 0.35 + shade * 0.65);
      const value = Math.round(relief * 255);

      outBuf[i] = value;
      outBuf[i + 1] = value;
      outBuf[i + 2] = value;
      outBuf[i + 3] = source[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Motion Relief",
  func: temporalRelief,
  optionTypes,
  options: defaults,
  defaults,
  description: "Convert recent motion history into embossed grayscale surface shading so change reads like raised relief",
  temporal: true,
});
