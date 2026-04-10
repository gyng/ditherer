import { RANGE, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

export const optionTypes = {
  blendFactor: { type: RANGE, range: [0.1, 0.95], step: 0.05, default: 0.7, desc: "Weight of previous frame — higher = longer echo/ghost trail" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  blendFactor: optionTypes.blendFactor.default,
  animSpeed: optionTypes.animSpeed.default,
};

const frameBlend = (input, options: any = defaults) => {
  const { blendFactor } = options;
  const prevOutput: Uint8ClampedArray | null = (options as any)._prevOutput || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const currentWeight = 1 - blendFactor;

  for (let i = 0; i < buf.length; i += 4) {
    if (prevOutput) {
      outBuf[i]     = Math.round(prevOutput[i] * blendFactor + buf[i] * currentWeight);
      outBuf[i + 1] = Math.round(prevOutput[i + 1] * blendFactor + buf[i + 1] * currentWeight);
      outBuf[i + 2] = Math.round(prevOutput[i + 2] * blendFactor + buf[i + 2] * currentWeight);
    } else {
      outBuf[i] = buf[i]; outBuf[i + 1] = buf[i + 1]; outBuf[i + 2] = buf[i + 2];
    }
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Frame Blend", func: frameBlend, optionTypes, options: defaults, defaults, mainThread: true, description: "Temporal blur — blend current frame with previous frames for ghosting/echo trails" };
