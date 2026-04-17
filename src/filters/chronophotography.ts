import { RANGE, ENUM, BOOL, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";
import { defineFilter } from "filters/types";

const BLEND = { LIGHTEN: "LIGHTEN", AVERAGE: "AVERAGE", DARKEN: "DARKEN" };
const FADE = { LINEAR: "LINEAR", TAIL: "TAIL", HEAD: "HEAD" };

// Module-level ring buffer for exposure frames
let expBuf: Uint8ClampedArray[] = [];
let expHead = 0;
let expW = 0;
let expH = 0;
let expCount = 0;
let expInterval = 0;
let frameSinceLastCapture = 0;

export const optionTypes = {
  exposures: { type: RANGE, range: [2, 16], step: 1, default: 8, desc: "Number of ghost copies visible" },
  interval: { type: RANGE, range: [1, 10], step: 1, default: 2, desc: "Frames between each exposure capture" },
  blendMode: {
    type: ENUM,
    options: [
      { name: "Lighten (Marey-style stroboscopic)", value: BLEND.LIGHTEN },
      { name: "Average (ghost trails)", value: BLEND.AVERAGE },
      { name: "Darken (dark subject on light bg)", value: BLEND.DARKEN },
    ],
    default: BLEND.LIGHTEN,
    desc: "How exposures combine. Lighten keeps the brightest pixel from any exposure (best for bright subject on dark bg).",
  },
  fadeMode: {
    type: ENUM,
    options: [
      { name: "Linear (equal weight)", value: FADE.LINEAR },
      { name: "Tail (oldest fades most)", value: FADE.TAIL },
      { name: "Head (newest fades most)", value: FADE.HEAD },
    ],
    default: FADE.LINEAR,
    desc: "Per-exposure weighting (Average mode only)",
  },
  isolateSubject: { type: BOOL, default: false, desc: "Only show moving parts of each exposure (uses EMA background model)" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  exposures: optionTypes.exposures.default,
  interval: optionTypes.interval.default,
  blendMode: optionTypes.blendMode.default,
  fadeMode: optionTypes.fadeMode.default,
  isolateSubject: optionTypes.isolateSubject.default,
  animSpeed: optionTypes.animSpeed.default,
};

const chronophotography = (input: any, options = defaults) => {
  const { exposures, interval, blendMode, fadeMode, isolateSubject } = options;
  const ema: Float32Array | null = (options as { _ema?: Float32Array | null })._ema || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Reset ring buffer if params changed
  if (expW !== W || expH !== H || expCount !== exposures || expInterval !== interval) {
    expBuf = [];
    expHead = 0;
    expW = W;
    expH = H;
    expCount = exposures;
    expInterval = interval;
    frameSinceLastCapture = interval;
  }

  // Capture frame at interval
  frameSinceLastCapture++;
  if (frameSinceLastCapture >= interval) {
    expBuf[expHead % exposures] = new Uint8ClampedArray(buf);
    expHead++;
    frameSinceLastCapture = 0;
  }

  const filled = Math.min(expHead, exposures);
  const outBuf = new Uint8ClampedArray(buf.length);
  const pixelCount = W * H;

  if (filled === 0) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  // Pre-compute weights for AVERAGE mode
  const weights = new Float32Array(filled);
  let totalWeight = 0;
  for (let f = 0; f < filled; f++) {
    if (fadeMode === FADE.TAIL) weights[f] = (f + 1);
    else if (fadeMode === FADE.HEAD) weights[f] = (filled - f);
    else weights[f] = 1;
    totalWeight += weights[f];
  }

  // Initialize accumulator
  const useAverage = blendMode === BLEND.AVERAGE;
  const accumR = useAverage ? new Float32Array(pixelCount) : null;
  const accumG = useAverage ? new Float32Array(pixelCount) : null;
  const accumB = useAverage ? new Float32Array(pixelCount) : null;
  const initVal = blendMode === BLEND.DARKEN ? 255 : 0;
  if (!useAverage) {
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      outBuf[i] = initVal; outBuf[i + 1] = initVal; outBuf[i + 2] = initVal;
    }
  }

  // Composite each captured exposure
  for (let f = 0; f < filled; f++) {
    const frameData = expBuf[((expHead - filled + f) % exposures + exposures) % exposures];
    if (!frameData) continue;
    const w = weights[f];

    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      const fr = frameData[i], fg = frameData[i + 1], fb = frameData[i + 2];

      // If isolating subject, only show pixels that differ from EMA (background)
      if (isolateSubject && ema) {
        const diff = (Math.abs(fr - ema[i]) + Math.abs(fg - ema[i + 1]) + Math.abs(fb - ema[i + 2])) / 3;
        if (diff < 15) continue;
      }

      if (blendMode === BLEND.LIGHTEN) {
        if (fr > outBuf[i]) outBuf[i] = fr;
        if (fg > outBuf[i + 1]) outBuf[i + 1] = fg;
        if (fb > outBuf[i + 2]) outBuf[i + 2] = fb;
      } else if (blendMode === BLEND.DARKEN) {
        if (fr < outBuf[i]) outBuf[i] = fr;
        if (fg < outBuf[i + 1]) outBuf[i + 1] = fg;
        if (fb < outBuf[i + 2]) outBuf[i + 2] = fb;
      } else {
        accumR![p] += fr * w;
        accumG![p] += fg * w;
        accumB![p] += fb * w;
      }
    }
  }

  // Normalize accumulator for AVERAGE mode
  if (useAverage) {
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      outBuf[i]     = Math.round(accumR![p] / totalWeight);
      outBuf[i + 1] = Math.round(accumG![p] / totalWeight);
      outBuf[i + 2] = Math.round(accumB![p] / totalWeight);
    }
  }

  // Set alpha
  for (let i = 3; i < outBuf.length; i += 4) outBuf[i] = 255;

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Chronophotography", func: chronophotography, optionTypes, options: defaults, defaults, description: "Multiple exposures of moving subjects — Marey's stroboscopic photography" });
