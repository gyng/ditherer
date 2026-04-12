import { RANGE, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";
import { defineFilter } from "filters/types";

let heldFrame: Uint8ClampedArray | null = null;
let heldW = 0;
let heldH = 0;
let lastHoldFrames = 0;
let holdCounter = 0;

export const optionTypes = {
  holdFrames: { type: RANGE, range: [2, 30], step: 1, default: 6, desc: "How many frames to hold before capturing a new pose" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  holdFrames: optionTypes.holdFrames.default,
  animSpeed: optionTypes.animSpeed.default,
};

const stopMotion = (input: any, options = defaults) => {
  const { holdFrames } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  if (!heldFrame || heldW !== W || heldH !== H || lastHoldFrames !== holdFrames) {
    heldFrame = new Uint8ClampedArray(buf);
    heldW = W;
    heldH = H;
    lastHoldFrames = holdFrames;
    holdCounter = 0;
  } else if (holdCounter >= holdFrames - 1) {
    heldFrame = new Uint8ClampedArray(buf);
    holdCounter = 0;
  } else {
    holdCounter++;
  }

  outputCtx.putImageData(new ImageData(new Uint8ClampedArray(heldFrame), W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Stop Motion", func: stopMotion, optionTypes, options: defaults, defaults, mainThread: true, description: "Hold each captured frame for several beats to create a choppy stop-motion feel" });
