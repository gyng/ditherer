import { ACTION, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";
import {
  MOTION_SOURCE,
  estimateMotionVector,
  prepareMotionAnalysisBuffers,
} from "utils/motionVectors";

const TRIGGER = {
  MANUAL: "MANUAL",
  MOTION: "MOTION",
  FLOW: "FLOW",
  SCENE_CUT: "SCENE_CUT",
  LUMA_SPIKE: "LUMA_SPIKE",
};

let burstStartFrame = -Infinity;
let burstEndFrame = -Infinity;
let burstCooldownUntil = -Infinity;
let previewLoopEnabled = false;
let pendingManualBurst = false;
let lastFrameIndex = -Infinity;
let lastTriggerMode = TRIGGER.MANUAL;

type CrtDegaussPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type CrtDegaussOptions = FilterOptionValues & {
  intensity?: number;
  warp?: number;
  misconvergence?: number;
  hueShimmer?: number;
  flash?: number;
  triggerMode?: string;
  triggerThreshold?: number;
  cooldownFrames?: number;
  duration?: number;
  animSpeed?: number;
  palette?: CrtDegaussPalette;
  _frameIndex?: number;
  _isAnimating?: boolean;
  _prevInput?: Uint8ClampedArray | null;
  _ema?: Float32Array | null;
};

const clamp = (value: number) => Math.max(0, Math.min(255, value));

const readChannel = (buf: Uint8ClampedArray, x: number, y: number, width: number, height: number, channel: number) => {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  return buf[getBufferIndex(clampedX, clampedY, width) + channel];
};

const rotateHue = (r: number, g: number, b: number, angle: number): [number, number, number] => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const nextR = r * (0.213 + 0.787 * cos - 0.213 * sin)
    + g * (0.715 - 0.715 * cos - 0.715 * sin)
    + b * (0.072 - 0.072 * cos + 0.928 * sin);
  const nextG = r * (0.213 - 0.213 * cos + 0.143 * sin)
    + g * (0.715 + 0.285 * cos + 0.140 * sin)
    + b * (0.072 - 0.072 * cos - 0.283 * sin);
  const nextB = r * (0.213 - 0.213 * cos - 0.787 * sin)
    + g * (0.715 - 0.715 * cos + 0.715 * sin)
    + b * (0.072 + 0.928 * cos + 0.072 * sin);

  return [clamp(nextR), clamp(nextG), clamp(nextB)];
};

const sampleTemporalEnergy = (
  current: Uint8ClampedArray,
  reference: Uint8ClampedArray | Float32Array | null,
  mode: string
) => {
  if (!reference || reference.length !== current.length) return 0;

  const maxSamples = 2048;
  const pixelCount = Math.max(1, current.length / 4);
  const pixelStride = Math.max(1, Math.floor(pixelCount / maxSamples));
  let total = 0;
  let samples = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += pixelStride) {
    const i = pixelIndex * 4;
    if (mode === TRIGGER.LUMA_SPIKE || mode === TRIGGER.SCENE_CUT) {
      const currentLuma = current[i] * 0.2126 + current[i + 1] * 0.7152 + current[i + 2] * 0.0722;
      const referenceLuma = reference[i] * 0.2126 + reference[i + 1] * 0.7152 + reference[i + 2] * 0.0722;
      total += Math.abs(currentLuma - referenceLuma) / 255;
    } else {
      total += (
        Math.abs(current[i] - reference[i]) +
        Math.abs(current[i + 1] - reference[i + 1]) +
        Math.abs(current[i + 2] - reference[i + 2])
      ) / (255 * 3);
    }
    samples += 1;
  }

  return samples > 0 ? total / samples : 0;
};

const sampleFlowEnergy = (
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray | null,
  width: number,
  height: number,
) => {
  if (!previous || previous.length !== current.length) return 0;

  const cellSize = Math.max(6, Math.min(20, Math.round(Math.min(width, height) / 18) || 6));
  const searchRadius = Math.max(2, Math.min(8, Math.round(cellSize * 0.45)));
  const threshold = 18;
  const analysisBuffers = prepareMotionAnalysisBuffers(current, previous, width, height, MOTION_SOURCE.LUMA);
  const stride = Math.max(cellSize, cellSize * 2);
  let total = 0;
  let count = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const vector = estimateMotionVector(
        current,
        previous,
        width,
        height,
        x,
        y,
        cellSize,
        searchRadius,
        threshold,
        MOTION_SOURCE.LUMA,
        analysisBuffers,
      );
      total += vector.motionStrength * (0.35 + vector.confidence * 0.65);
      count += 1;
    }
  }

  return count > 0 ? total / count : 0;
};

const startBurst = (frameIndex: number, duration: number, cooldownFrames: number) => {
  burstStartFrame = frameIndex;
  burstEndFrame = frameIndex + duration;
  burstCooldownUntil = frameIndex + cooldownFrames;
};

export const optionTypes = {
  intensity: { type: RANGE, range: [0.25, 2.5], step: 0.05, default: 1, desc: "Overall strength of the degauss pulse envelope" },
  warp: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Raster bending and ring-wave distortion amount" },
  misconvergence: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "RGB channel separation during the magnetic wobble" },
  hueShimmer: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Rainbow phosphor mislanding from the changing field" },
  flash: { type: RANGE, range: [0, 2], step: 0.05, default: 0.9, desc: "Brightness pulse riding on top of the degauss sweep" },
  triggerMode: {
    type: ENUM,
    options: [
      { name: "Manual", value: TRIGGER.MANUAL },
      { name: "Motion threshold", value: TRIGGER.MOTION },
      { name: "Flow", value: TRIGGER.FLOW },
      { name: "Scene cut", value: TRIGGER.SCENE_CUT },
      { name: "Luma spike", value: TRIGGER.LUMA_SPIKE },
    ],
    default: TRIGGER.MANUAL,
    desc: "Choose whether the pulse is manual or auto-triggers from source motion and luminance changes"
  },
  triggerThreshold: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.18, desc: "Minimum sampled source energy required to fire an automatic degauss pulse" },
  cooldownFrames: { type: RANGE, range: [0, 180], step: 1, default: 36, desc: "Minimum wait after a pulse before auto-triggering again" },
  duration: { type: RANGE, range: [12, 90], step: 1, default: 45, desc: "Length of the degauss decay in rendered frames" },
  animSpeed: { type: RANGE, range: [4, 30], step: 1, default: 20, desc: "Playback speed for the burst preview" },
  degauss: {
    type: ACTION,
    label: "Degauss",
    action: (actions, inputCanvas, _filterFunc, options) => {
      pendingManualBurst = true;
      actions.triggerBurst(inputCanvas, Math.max(6, Math.round(options.duration || 45)), options.animSpeed || 20);
    }
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) {
        previewLoopEnabled = false;
        actions.stopAnimLoop();
      } else {
        previewLoopEnabled = true;
        actions.startAnimLoop(inputCanvas, options.animSpeed || 20);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  warp: optionTypes.warp.default,
  misconvergence: optionTypes.misconvergence.default,
  hueShimmer: optionTypes.hueShimmer.default,
  flash: optionTypes.flash.default,
  triggerMode: optionTypes.triggerMode.default,
  triggerThreshold: optionTypes.triggerThreshold.default,
  cooldownFrames: optionTypes.cooldownFrames.default,
  duration: optionTypes.duration.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const crtDegauss = (input, options: CrtDegaussOptions = defaults) => {
  const {
    intensity,
    warp,
    misconvergence,
    hueShimmer,
    flash,
    triggerMode,
    triggerThreshold,
    cooldownFrames,
    duration,
    palette
  } = options;

  const frameIndex = Number(options._frameIndex ?? 0);
  const isAnimating = Boolean(options._isAnimating);
  const prevInput = options._prevInput ?? null;
  const ema = options._ema ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const safeDuration = Math.max(6, Math.round(duration || 45));

  if (frameIndex <= lastFrameIndex || triggerMode !== lastTriggerMode) {
    burstStartFrame = -Infinity;
    burstEndFrame = -Infinity;
    burstCooldownUntil = -Infinity;
    pendingManualBurst = false;
    if (triggerMode !== lastTriggerMode) {
      previewLoopEnabled = false;
    }
  }
  lastTriggerMode = triggerMode;

  if (!isAnimating && !pendingManualBurst) {
    burstStartFrame = -Infinity;
    burstEndFrame = -Infinity;
    lastFrameIndex = frameIndex;
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
    return output;
  }

  if (pendingManualBurst) {
    startBurst(frameIndex, safeDuration, Math.round(cooldownFrames || 0));
    pendingManualBurst = false;
  } else if (previewLoopEnabled && isAnimating && frameIndex >= burstEndFrame) {
    startBurst(frameIndex, safeDuration, 0);
  } else if (
    triggerMode !== TRIGGER.MANUAL
    && frameIndex >= burstCooldownUntil
  ) {
    const reference = triggerMode === TRIGGER.MOTION || triggerMode === TRIGGER.FLOW ? prevInput : ema;
    const energy = triggerMode === TRIGGER.FLOW
      ? sampleFlowEnergy(buf, prevInput, width, height)
      : sampleTemporalEnergy(buf, reference, triggerMode);
    if (energy >= triggerThreshold) {
      startBurst(frameIndex, safeDuration, Math.round(cooldownFrames || 0));
    }
  }
  lastFrameIndex = frameIndex;

  const isBurstActive = frameIndex >= burstStartFrame && frameIndex < burstEndFrame;
  if (!isBurstActive) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
    return output;
  }

  const age = frameIndex - burstStartFrame;
  const normalizedAge = age / Math.max(1, safeDuration - 1);
  const decay = 1 - normalizedAge;
  const envelope = Math.max(0, decay * decay * intensity);

  const centerX = width / 2;
  const centerY = height / 2;
  const baseWobbleX = Math.sin(age * 1.7) * envelope * width * 0.05 + Math.sin(age * 4.1) * envelope * decay * width * 0.025;
  const baseWobbleY = Math.cos(age * 2.3) * envelope * height * 0.035 + Math.cos(age * 5.7) * envelope * decay * height * 0.018;
  const flashAmount = 1 + flash * envelope * (0.4 + 0.8 * Math.abs(Math.sin(age * 0.8)));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = getBufferIndex(x, y, width);
      const dx = (x - centerX) / Math.max(1, centerX);
      const dy = (y - centerY) / Math.max(1, centerY);
      const radial = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(radial * 18 - age * 1.85) * envelope * warp * Math.min(width, height) * 0.04;
      const sweepX = Math.sin(y / Math.max(1, height) * Math.PI * (2.8 + age * 0.12) + age * 1.9) * envelope * warp * width * 0.045;
      const sweepY = Math.sin(x / Math.max(1, width) * Math.PI * (3.5 + age * 0.08) + age * 2.7) * envelope * warp * height * 0.024;

      const srcX = Math.round(x + sweepX + dx * ring);
      const srcY = Math.round(y + sweepY + dy * ring * 0.7);

      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
        fillBufferPixel(outBuf, index, 0, 0, 0, buf[index + 3]);
        continue;
      }

      const channelOffset = misconvergence * envelope * (2 + radial * 6);
      const wobbleX = baseWobbleX * (0.3 + radial * 0.7);
      const wobbleY = baseWobbleY * (0.3 + radial * 0.7);

      const r = readChannel(buf, Math.round(srcX + dx * channelOffset + wobbleX), Math.round(srcY + dy * channelOffset * 0.35 + wobbleY), width, height, 0);
      const g = readChannel(buf, Math.round(srcX + wobbleX * 0.18), Math.round(srcY + wobbleY * 0.22), width, height, 1);
      const b = readChannel(buf, Math.round(srcX - dx * channelOffset - wobbleX * 0.7), Math.round(srcY - dy * channelOffset * 0.35 - wobbleY * 0.7), width, height, 2);

      const hueAngle = hueShimmer * envelope * Math.PI * 1.35
        * Math.sin(dx * 2.7 + age * 1.25)
        * Math.cos(dy * 2.1 + age * 0.92);
      const [shiftedR, shiftedG, shiftedB] = rotateHue(r, g, b, hueAngle);

      const edgeDarken = 1 - Math.min(0.22, radial * radial * envelope * 0.2);
      const color = paletteGetColor(
        palette,
        rgba(
          clamp(shiftedR * flashAmount * edgeDarken),
          clamp(shiftedG * flashAmount * edgeDarken),
          clamp(shiftedB * flashAmount * edgeDarken),
          buf[index + 3]
        ),
        palette.options,
        false
      );

      fillBufferPixel(outBuf, index, color[0], color[1], color[2], buf[index + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "CRT Degauss",
  func: crtDegauss,
  options: defaults,
  optionTypes,
  defaults,
  mainThread: true,
  description: "A decaying CRT degauss pulse with raster wobble, RGB mislanding, rainbow shimmer, and a bright magnetic flash"
});
