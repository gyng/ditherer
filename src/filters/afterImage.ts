import { RANGE, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

export const optionTypes = {
  persistence: { type: RANGE, range: [0.01, 0.2], step: 0.01, default: 0.05, desc: "How fast the after-image fades" },
  strength: { type: RANGE, range: [0.5, 2], step: 0.1, default: 1, desc: "Intensity of the negative ghost" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  persistence: optionTypes.persistence.default,
  strength: optionTypes.strength.default,
  animSpeed: optionTypes.animSpeed.default,
};

const afterImage = (input, options: any = defaults) => {
  const { persistence, strength } = options;
  const prevOutput: Uint8ClampedArray | null = (options as any)._prevOutput || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < buf.length; i += 4) {
    if (!prevOutput) {
      outBuf[i] = buf[i]; outBuf[i + 1] = buf[i + 1]; outBuf[i + 2] = buf[i + 2];
    } else {
      // After-image is the complement of what was there before
      const afterR = (255 - prevOutput[i]) * strength;
      const afterG = (255 - prevOutput[i + 1]) * strength;
      const afterB = (255 - prevOutput[i + 2]) * strength;

      // Blend current with lingering negative of previous
      outBuf[i]     = Math.min(255, Math.max(0, Math.round(buf[i]     + (afterR - buf[i])     * persistence)));
      outBuf[i + 1] = Math.min(255, Math.max(0, Math.round(buf[i + 1] + (afterG - buf[i + 1]) * persistence)));
      outBuf[i + 2] = Math.min(255, Math.max(0, Math.round(buf[i + 2] + (afterB - buf[i + 2]) * persistence)));
    }
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "After-Image", func: afterImage, optionTypes, options: defaults, defaults, description: "Complementary-colored ghost when bright objects move away — retinal fatigue simulation" };
