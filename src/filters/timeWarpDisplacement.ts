import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

const SOURCE = {
  LUMINANCE: "LUMINANCE",
  X: "X",
  Y: "Y"
};

const DIRECTION = {
  BRIGHT_RECENT: "BRIGHT_RECENT",
  BRIGHT_OLDEST: "BRIGHT_OLDEST"
};

let ringBuf: Uint8ClampedArray[] = [];
let ringHead = 0;
let ringW = 0;
let ringH = 0;
let ringDepth = 0;

export const optionTypes = {
  depth: { type: RANGE, range: [4, 30], step: 1, default: 16, desc: "How many frames of history the warp can sample across" },
  source: {
    type: ENUM,
    options: [
      { name: "Luminance", value: SOURCE.LUMINANCE },
      { name: "Position X", value: SOURCE.X },
      { name: "Position Y", value: SOURCE.Y }
    ],
    default: SOURCE.LUMINANCE,
    desc: "What drives the per-pixel frame delay"
  },
  direction: {
    type: ENUM,
    options: [
      { name: "Bright = recent", value: DIRECTION.BRIGHT_RECENT },
      { name: "Bright = oldest", value: DIRECTION.BRIGHT_OLDEST }
    ],
    default: DIRECTION.BRIGHT_RECENT,
    desc: "How the driver maps into older or newer history"
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  depth: optionTypes.depth.default,
  source: optionTypes.source.default,
  direction: optionTypes.direction.default,
  animSpeed: optionTypes.animSpeed.default,
};

const timeWarpDisplacement = (input, options: any = defaults) => {
  const { depth, source, direction } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  if (ringW !== W || ringH !== H || ringDepth !== depth) {
    ringBuf = [];
    ringHead = 0;
    ringW = W;
    ringH = H;
    ringDepth = depth;
  }

  ringBuf[ringHead % depth] = new Uint8ClampedArray(buf);
  ringHead++;
  const filled = Math.min(ringHead, depth);
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let t = source === SOURCE.X
        ? x / Math.max(1, W - 1)
        : source === SOURCE.Y
          ? y / Math.max(1, H - 1)
          : (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;

      if (direction === DIRECTION.BRIGHT_OLDEST) t = 1 - t;

      const frameOffset = Math.min(filled - 1, Math.round(t * (filled - 1)));
      const frame = ringBuf[((ringHead - 1 - frameOffset) % depth + depth) % depth] || buf;
      outBuf[i] = frame[i];
      outBuf[i + 1] = frame[i + 1];
      outBuf[i + 2] = frame[i + 2];
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Time-warp Displacement", func: timeWarpDisplacement, optionTypes, options: defaults, defaults, mainThread: true, description: "Sample different moments from recent history on a per-pixel basis for surreal time-sliced motion warping" };
