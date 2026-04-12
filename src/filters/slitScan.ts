import { RANGE, ENUM, BOOL, ACTION } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";
import { defineFilter } from "filters/types";

const DIR = { HORIZONTAL: "HORIZONTAL", VERTICAL: "VERTICAL" };
const SCAN = { CENTER: "CENTER", LEFT: "LEFT", RIGHT: "RIGHT" };
const MAX_BYTES = 40 * 1024 * 1024; // 40MB cap

// Module-level ring buffer
let ringBuf: Uint8ClampedArray[] = [];
let ringHead = 0;
let ringW = 0;
let ringH = 0;
let ringDepth = 0;

export const optionTypes = {
  direction: {
    type: ENUM,
    options: [
      { name: "Horizontal (columns = time)", value: DIR.HORIZONTAL },
      { name: "Vertical (rows = time)", value: DIR.VERTICAL },
    ],
    default: DIR.HORIZONTAL,
    desc: "Whether columns or rows represent time slices",
  },
  depth: { type: RANGE, range: [2, 60], step: 1, default: 30, desc: "Frames of history to scan across" },
  reverse: { type: BOOL, default: false, desc: "Flip the time direction" },
  scanLine: {
    type: ENUM,
    options: [
      { name: "Center", value: SCAN.CENTER },
      { name: "Left / Top", value: SCAN.LEFT },
      { name: "Right / Bottom", value: SCAN.RIGHT },
    ],
    default: SCAN.CENTER,
    desc: "Which column/row captures the live slice",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  direction: optionTypes.direction.default,
  depth: optionTypes.depth.default,
  reverse: optionTypes.reverse.default,
  scanLine: optionTypes.scanLine.default,
  animSpeed: optionTypes.animSpeed.default,
};

const slitScan = (input: any, options = defaults) => {
  const { direction, reverse } = options;
  let { depth } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Auto-cap depth to memory budget
  const bytesPerFrame = W * H * 4;
  const maxDepth = Math.max(2, Math.floor(MAX_BYTES / bytesPerFrame));
  depth = Math.min(depth, maxDepth);

  // Reset ring buffer if dimensions changed
  if (ringW !== W || ringH !== H || ringDepth !== depth) {
    ringBuf = [];
    ringHead = 0;
    ringW = W;
    ringH = H;
    ringDepth = depth;
  }

  // Push current frame into ring buffer
  ringBuf[ringHead % depth] = new Uint8ClampedArray(buf);
  ringHead++;

  const filled = Math.min(ringHead, depth);
  const outBuf = new Uint8ClampedArray(buf.length);
  const isHorizontal = direction === DIR.HORIZONTAL;
  const slices = isHorizontal ? W : H;

  for (let s = 0; s < slices; s++) {
    // Map slice index to a frame in the ring buffer
    const frameOffset = Math.floor(s * (filled - 1) / Math.max(1, slices - 1));
    const idx = reverse ? frameOffset : (filled - 1 - frameOffset);
    const frameData = ringBuf[((ringHead - 1 - idx) % depth + depth) % depth];
    if (!frameData) continue;

    if (isHorizontal) {
      // Copy column s from the selected frame
      for (let y = 0; y < H; y++) {
        const oi = getBufferIndex(s, y, W);
        const si = getBufferIndex(s, y, W);
        outBuf[oi] = frameData[si]; outBuf[oi + 1] = frameData[si + 1];
        outBuf[oi + 2] = frameData[si + 2]; outBuf[oi + 3] = 255;
      }
    } else {
      // Copy row s from the selected frame
      for (let x = 0; x < W; x++) {
        const oi = getBufferIndex(x, s, W);
        const si = getBufferIndex(x, s, W);
        outBuf[oi] = frameData[si]; outBuf[oi + 1] = frameData[si + 1];
        outBuf[oi + 2] = frameData[si + 2]; outBuf[oi + 3] = 255;
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Slit Scan", func: slitScan, optionTypes, options: defaults, defaults, mainThread: true, description: "Each column/row shows a different point in time — surreal temporal stretching" });
