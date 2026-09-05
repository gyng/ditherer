import { ACTION, RANGE, PALETTE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
} from "../utils/index";
import { normalizePaletteOption, normalizeRangeOption } from "../utils/filterOptions";
import {
  estimateMotionVector,
  prepareMotionAnalysisBuffers,
  MOTION_SOURCE,
} from "../utils/motionVectors";

export const optionTypes = {
  blockSize: {
    type: RANGE,
    range: [4, 32],
    step: 1,
    default: 16,
    desc: "Macro-block size for motion compensation",
  },
  motionThreshold: {
    type: RANGE,
    range: [0, 100],
    step: 1,
    default: 20,
    desc: "Per-pixel error threshold for accepting a block's motion match",
  },
  displacement: {
    type: RANGE,
    range: [0, 30],
    step: 1,
    default: 8,
    desc: "Motion-vector search radius in pixels",
  },
  keyframeInterval: {
    type: RANGE,
    range: [0, 120],
    step: 1,
    default: 24,
    desc: "Frames between clean keyframe refreshes (0 = never refresh — smear forever)",
  },
  corruptChance: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.15,
    desc: "Probability a block's motion vector is corrupted (bloom/tearing)",
  },
  channelShift: {
    type: RANGE,
    range: [0, 10],
    step: 1,
    default: 2,
    desc: "RGB channel misalignment in pixels on moshed blocks",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
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
  blockSize: optionTypes.blockSize.default,
  motionThreshold: optionTypes.motionThreshold.default,
  displacement: optionTypes.displacement.default,
  keyframeInterval: optionTypes.keyframeInterval.default,
  corruptChance: optionTypes.corruptChance.default,
  channelShift: optionTypes.channelShift.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type DatamoshPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type DatamoshOptions = FilterOptionValues & {
  blockSize?: number;
  motionThreshold?: number;
  displacement?: number;
  keyframeInterval?: number;
  corruptChance?: number;
  channelShift?: number;
  animSpeed?: number;
  palette?: DatamoshPalette;
  _prevInput?: Uint8ClampedArray | null;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
};

// Deterministic per-frame PRNG for the corrupt-vector decisions.
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Datamoshing: when a codec's I-frames are dropped, the decoder keeps applying
// each macro-block's motion vectors to whatever is already in the frame buffer,
// dragging the held content along the motion field (the signature smear/bloom).
// This filter estimates the real per-block motion between the current and
// previous input frame, then predicts each block from the previous *output*
// frame at the motion-compensated position — P-frame prediction without an
// I-frame refresh. (The previous filter displaced blocks by a random offset and
// never estimated a vector at all.)
const datamosh = (input: any, options: DatamoshOptions = defaults) => {
  const blockSize = normalizeRangeOption(options.blockSize, defaults.blockSize, 4, 32, true);
  const motionThreshold = normalizeRangeOption(
    options.motionThreshold,
    defaults.motionThreshold,
    0,
    100,
  );
  const displacement = normalizeRangeOption(
    options.displacement,
    defaults.displacement,
    0,
    30,
    true,
  );
  const keyframeInterval = normalizeRangeOption(
    options.keyframeInterval,
    defaults.keyframeInterval,
    0,
    120,
    true,
  );
  const corruptChance = normalizeRangeOption(options.corruptChance, defaults.corruptChance, 0, 1);
  const channelShift = normalizeRangeOption(
    options.channelShift,
    defaults.channelShift,
    0,
    10,
    true,
  );
  const palette = normalizePaletteOption(options.palette, defaults.palette);

  const prevInput = options._prevInput ?? null;
  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const haveRefs =
    !!prevInput &&
    !!prevOutput &&
    prevInput.length === buf.length &&
    prevOutput.length === buf.length;
  const isKeyframe = !haveRefs || (keyframeInterval > 0 && frameIndex % keyframeInterval === 0);

  // On a keyframe (or with no reference frames) emit the clean current frame.
  if (isKeyframe) {
    for (let i = 0; i < buf.length; i += 4) {
      const color = paletteGetColor(
        palette,
        rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]),
        palette.options,
        false,
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  const ref = prevOutput as Uint8ClampedArray;
  const rng = mulberry32(frameIndex * 7919 + 31337);
  // Bound the search so tiny blocks with a large displacement don't blow up the
  // per-frame cost (a 4px block matched over ±30px is unreliable anyway);
  // block sizes of ~15px and up still honour the full displacement.
  const searchRadius = Math.min(displacement, blockSize * 2);
  const threshold = (motionThreshold / 100) * 255;
  const buffers = prepareMotionAnalysisBuffers(
    buf,
    prevInput as Uint8ClampedArray,
    W,
    H,
    MOTION_SOURCE.LUMA,
  );

  const blocksX = Math.ceil(W / blockSize);
  const blocksY = Math.ceil(H / blockSize);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, W);
      const endY = Math.min(startY + blockSize, H);

      // Real block-matching motion vector (current vs previous input frame).
      const vector = estimateMotionVector(
        buf,
        prevInput as Uint8ClampedArray,
        W,
        H,
        startX,
        startY,
        blockSize,
        searchRadius,
        threshold,
        MOTION_SOURCE.LUMA,
        buffers,
      );
      let vx = vector.dx;
      let vy = vector.dy;

      // Reject an unreliable match: when the best block error exceeds the
      // threshold there is no trustworthy motion, so hold the block in place
      // (predict it unmoved from the reference) rather than apply a bogus
      // vector. Lower motionThreshold freezes more; higher moshes more.
      if (vector.error > threshold) {
        vx = 0;
        vy = 0;
      }

      // Corrupt path: perturb the vector so the held frame blooms / tears.
      if (rng() < corruptChance) {
        vx += Math.round((rng() - 0.5) * (displacement + 4) * 2);
        vy += Math.round((rng() - 0.5) * (displacement + 4) * 2);
      }
      const chShiftX = channelShift > 0 ? Math.round((rng() - 0.5) * channelShift * 2) : 0;

      // Predict the block from the previous OUTPUT frame at the
      // motion-compensated position: ref(p + v) ≈ current(p).
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const sx = Math.max(0, Math.min(W - 1, x + vx));
          const sy = Math.max(0, Math.min(H - 1, y + vy));
          const si = getBufferIndex(sx, sy, W);
          const rx = Math.max(0, Math.min(W - 1, sx + chShiftX));
          const ri = getBufferIndex(rx, sy, W);
          const i = getBufferIndex(x, y, W);
          const color = paletteGetColor(
            palette,
            rgba(ref[ri], ref[si + 1], ref[si + 2], ref[si + 3]),
            palette.options,
            false,
          );
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], ref[si + 3]);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  history: { prevInput: true, prevOutput: true },
  name: "Datamosh",
  func: datamosh,
  options: defaults,
  optionTypes,
  defaults,
  noWASM:
    "Per-block full-search motion estimation plus a motion-compensated gather from the previous output frame; the heavy work is the SAD search, not vectorisable pixel math.",
  noGL: "Per-block motion estimation is a reduction/search unfriendly to fragment shaders without compute.",
  temporal: true,
});
