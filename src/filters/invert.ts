import { BOOL } from "@src/constants/controlTypes";
import { cloneCanvas, fillBufferPixel, getBufferIndex } from "@src/util";

export const optionTypes = {
  invertR: { type: BOOL, default: true },
  invertG: { type: BOOL, default: true },
  invertB: { type: BOOL, default: true },
  invertA: { type: BOOL, default: false },
};

export const defaults = {
  invertR: optionTypes.invertR.default,
  invertG: optionTypes.invertG.default,
  invertB: optionTypes.invertB.default,
  invertA: optionTypes.invertA.default,
};

const invert = (
  input: HTMLCanvasElement,
  options: {
    invertR: boolean;
    invertG: boolean;
    invertB: boolean;
    invertA: boolean;
  } = defaults
): HTMLCanvasElement => {
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const r = options.invertR ? 255 - buf[i] : buf[i];
      const g = options.invertG ? 255 - buf[i + 1] : buf[i + 1];
      const b = options.invertB ? 255 - buf[i + 2] : buf[i + 2];
      const a = options.invertA ? 255 - buf[i + 3] : buf[i + 3];
      fillBufferPixel(buf, i, r, g, b, a);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Invert",
  func: invert,
  options: defaults,
  optionTypes,
  defaults,
};
