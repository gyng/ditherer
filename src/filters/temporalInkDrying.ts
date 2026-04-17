import { ACTION, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

let wetnessMap: Float32Array | null = null;
let pigmentMap: Float32Array | null = null;
let wetWidth = 0;
let wetHeight = 0;
let lastFrameIndex = -1;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const STYLE = {
  FOUNTAIN_PEN: "FOUNTAIN_PEN",
  BRUSH_INK: "BRUSH_INK",
  MARKER_BLEED: "MARKER_BLEED",
};

const resetWetness = (width: number, height: number) => {
  wetnessMap = new Float32Array(width * height);
  pigmentMap = new Float32Array(width * height);
  wetWidth = width;
  wetHeight = height;
};

export const optionTypes = {
  style: {
    type: ENUM,
    options: [
      { name: "Fountain pen", value: STYLE.FOUNTAIN_PEN },
      { name: "Brush ink", value: STYLE.BRUSH_INK },
      { name: "Marker bleed", value: STYLE.MARKER_BLEED },
    ],
    default: STYLE.FOUNTAIN_PEN,
    desc: "Choose a restrained pen line, richer brush wash, or heavy marker bleed character",
  },
  inkThreshold: { type: RANGE, range: [32, 255], step: 1, default: 176, desc: "Pixels darker than this are treated as freshly inked marks" },
  dryRate: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.05, desc: "How quickly wet marks dry and relax toward the source image" },
  darkenAmount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "How much extra darkness wet ink adds before it dries" },
  edgeShrink: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "How much the wet core recedes as the mark dries" },
  paperBleed: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "How far neighboring wetness blooms into surrounding pixels" },
  paperWarmth: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Warm paper tone that blooms around wet edges as the ink dries" },
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
  style: optionTypes.style.default,
  inkThreshold: optionTypes.inkThreshold.default,
  dryRate: optionTypes.dryRate.default,
  darkenAmount: optionTypes.darkenAmount.default,
  edgeShrink: optionTypes.edgeShrink.default,
  paperBleed: optionTypes.paperBleed.default,
  paperWarmth: optionTypes.paperWarmth.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalInkDryingOptions = FilterOptionValues & {
  style?: string;
  inkThreshold?: number;
  dryRate?: number;
  darkenAmount?: number;
  edgeShrink?: number;
  paperBleed?: number;
  paperWarmth?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const temporalInkDrying = (input: any, options: TemporalInkDryingOptions = defaults) => {
  const style = options.style ?? defaults.style;
  const inkThreshold = Number(options.inkThreshold ?? defaults.inkThreshold);
  const styleDryRate = style === STYLE.BRUSH_INK ? 0.035 : style === STYLE.MARKER_BLEED ? 0.06 : 0.05;
  const styleDarken = style === STYLE.BRUSH_INK ? 0.9 : style === STYLE.MARKER_BLEED ? 0.7 : 0.82;
  const styleEdgeShrink = style === STYLE.BRUSH_INK ? 0.18 : style === STYLE.MARKER_BLEED ? 0.55 : 0.38;
  const stylePaperBleed = style === STYLE.BRUSH_INK ? 0.35 : style === STYLE.MARKER_BLEED ? 0.7 : 0.42;
  const stylePaperWarmth = style === STYLE.BRUSH_INK ? 0.65 : style === STYLE.MARKER_BLEED ? 0.28 : 0.52;
  const dryRate = clamp01(Number(options.dryRate ?? styleDryRate));
  const darkenAmount = clamp01(Number(options.darkenAmount ?? styleDarken));
  const edgeShrink = clamp01(Number(options.edgeShrink ?? styleEdgeShrink));
  const paperBleed = clamp01(Number(options.paperBleed ?? stylePaperBleed));
  const paperWarmth = clamp01(Number(options.paperWarmth ?? stylePaperWarmth));
  const frameIndex = Number(options._frameIndex ?? 0);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const source = inputCtx.getImageData(0, 0, width, height).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;

  if (!wetnessMap || !pigmentMap || wetWidth !== width || wetHeight !== height || restartedAnimation) {
    resetWetness(width, height);
  }
  lastFrameIndex = frameIndex;

  const previousWetness = new Float32Array(wetnessMap!);
  const previousPigment = new Float32Array(pigmentMap!);
  const outBuf = new Uint8ClampedArray(source.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const i = pixelIndex * 4;
      const luma = 0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2];
      const freshInk = clamp01((inkThreshold - luma) / Math.max(1, inkThreshold));
      const retainedWetness = previousWetness[pixelIndex] * (1 - dryRate);
      const retainedPigment = previousPigment[pixelIndex] * (1 - dryRate * 0.45);
      const pigment = Math.max(freshInk, retainedPigment);
      const wetness = Math.max(freshInk, retainedWetness, pigment * 0.7);
      wetnessMap![pixelIndex] = wetness;
      pigmentMap![pixelIndex] = pigment;

      let neighborWet = wetness;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          neighborWet = Math.max(neighborWet, previousWetness[ny * width + nx]);
        }
      }

      const dryProgress = clamp01(1 - wetness);
      const core = Math.max(0, pigment * (1 - edgeShrink * dryProgress));
      const spread = neighborWet * paperBleed;
      const halo = clamp01(
        (spread - core * (style === STYLE.MARKER_BLEED ? 0.22 : 0.4)) *
        (style === STYLE.BRUSH_INK ? 0.72 : 0.55) *
        (1 + dryProgress * (style === STYLE.MARKER_BLEED ? 0.15 : 0.35))
      );
      const inkAmount = clamp01(
        core * darkenAmount +
        wetness * (style === STYLE.BRUSH_INK ? 0.24 : style === STYLE.MARKER_BLEED ? 0.12 : 0.18)
      );
      const paperTint = halo * paperWarmth * (0.55 + dryProgress * 0.45);
      const sourceWeight = style === STYLE.MARKER_BLEED ? 0.86 : style === STYLE.BRUSH_INK ? 0.8 : 0.9;
      const inkTintR = style === STYLE.MARKER_BLEED ? 64 : style === STYLE.BRUSH_INK ? 18 : 10;
      const inkTintG = style === STYLE.MARKER_BLEED ? 52 : style === STYLE.BRUSH_INK ? 16 : 10;
      const inkTintB = style === STYLE.MARKER_BLEED ? 68 : style === STYLE.BRUSH_INK ? 24 : 18;

      outBuf[i] = clampByte(source[i] * (1 - inkAmount * sourceWeight) + inkTintR * inkAmount + 214 * halo + 234 * paperTint);
      outBuf[i + 1] = clampByte(source[i + 1] * (1 - inkAmount * sourceWeight) + inkTintG * inkAmount + 188 * halo + 219 * paperTint);
      outBuf[i + 2] = clampByte(source[i + 2] * (1 - inkAmount * sourceWeight) + inkTintB * inkAmount + 156 * halo + 190 * paperTint);
      outBuf[i + 3] = source[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Ink Drying",
  func: temporalInkDrying,
  optionTypes,
  options: defaults,
  defaults,
  description: "Fresh marks dry like fountain pen lines, brush ink washes, or marker bleed depending on the chosen paper-and-ink style",
  temporal: true,
});
