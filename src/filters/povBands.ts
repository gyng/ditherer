import { RANGE, ACTION } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";
import { defineFilter } from "filters/types";

let ringBuf: Uint8ClampedArray[] = [];
let ringHead = 0;
let ringW = 0;
let ringH = 0;
let ringDepth = 0;

export const optionTypes = {
  bands: { type: RANGE, range: [2, 20], step: 1, default: 8, desc: "Number of horizontal bands shown with different time offsets" },
  framesPerBand: { type: RANGE, range: [1, 10], step: 1, default: 3, desc: "How many frames older each band becomes than the one above it" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  bands: optionTypes.bands.default,
  framesPerBand: optionTypes.framesPerBand.default,
  animSpeed: optionTypes.animSpeed.default,
};

const povBands = (input, options = defaults) => {
  const { bands, framesPerBand } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const depth = Math.max(2, bands * framesPerBand);

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
  const bandHeight = Math.ceil(H / bands);

  for (let band = 0; band < bands; band++) {
    const frameOffset = Math.min(filled - 1, band * framesPerBand);
    const frame = ringBuf[((ringHead - 1 - frameOffset) % depth + depth) % depth] || buf;
    const y0 = band * bandHeight;
    const y1 = Math.min(H, y0 + bandHeight);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) {
        const i = getBufferIndex(x, y, W);
        outBuf[i] = frame[i];
        outBuf[i + 1] = frame[i + 1];
        outBuf[i + 2] = frame[i + 2];
        outBuf[i + 3] = 255;
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "POV Bands", func: povBands, optionTypes, options: defaults, defaults, mainThread: true, description: "Split the frame into horizontal bands that each show a different recent moment in time" });
