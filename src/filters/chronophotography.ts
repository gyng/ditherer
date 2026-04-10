import { RANGE, ENUM, BOOL, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

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
  exposures: { type: RANGE, range: [3, 12], step: 1, default: 6, desc: "Number of ghost copies visible" },
  interval: { type: RANGE, range: [1, 10], step: 1, default: 3, desc: "Frames between each exposure capture" },
  fadeMode: {
    type: ENUM,
    options: [
      { name: "Linear (equal opacity)", value: FADE.LINEAR },
      { name: "Tail (oldest fades most)", value: FADE.TAIL },
      { name: "Head (newest fades most)", value: FADE.HEAD },
    ],
    default: FADE.LINEAR,
    desc: "How ghost copies fade",
  },
  isolateSubject: { type: BOOL, default: false, desc: "Only show moving parts of each exposure" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  exposures: optionTypes.exposures.default,
  interval: optionTypes.interval.default,
  fadeMode: optionTypes.fadeMode.default,
  isolateSubject: optionTypes.isolateSubject.default,
  animSpeed: optionTypes.animSpeed.default,
};

const chronophotography = (input, options: any = defaults) => {
  const { exposures, interval, fadeMode, isolateSubject } = options;
  const ema: Float32Array | null = (options as any)._ema || null;
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
    frameSinceLastCapture = interval; // capture immediately
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

  // Start with black background
  outBuf.fill(0);
  for (let i = 3; i < outBuf.length; i += 4) outBuf[i] = 255;

  // Composite exposures from oldest to newest
  for (let f = 0; f < filled; f++) {
    const frameData = expBuf[((expHead - filled + f) % exposures + exposures) % exposures];
    if (!frameData) continue;

    let alpha: number;
    if (fadeMode === FADE.TAIL) {
      alpha = (f + 1) / filled;
    } else if (fadeMode === FADE.HEAD) {
      alpha = 1 - f / filled;
    } else {
      alpha = 1 / filled;
    }

    for (let i = 0; i < buf.length; i += 4) {
      // If isolating subject, only show pixels that differ from EMA (background)
      if (isolateSubject && ema) {
        const diff = (Math.abs(frameData[i] - ema[i]) + Math.abs(frameData[i + 1] - ema[i + 1]) + Math.abs(frameData[i + 2] - ema[i + 2])) / 3;
        if (diff < 15) continue;
      }

      outBuf[i]     = Math.min(255, Math.round(outBuf[i]     * (1 - alpha) + frameData[i]     * alpha));
      outBuf[i + 1] = Math.min(255, Math.round(outBuf[i + 1] * (1 - alpha) + frameData[i + 1] * alpha));
      outBuf[i + 2] = Math.min(255, Math.round(outBuf[i + 2] * (1 - alpha) + frameData[i + 2] * alpha));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Chronophotography", func: chronophotography, optionTypes, options: defaults, defaults, description: "Multiple exposures of moving subjects — Marey's stroboscopic photography" };
