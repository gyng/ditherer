// @flow

import { cloneCanvas, getBufferIndex } from "./util";

const binarize = (
  input: HTMLCanvasElement,
  options: { threshold: number } = { threshold: 127 }
): HTMLCanvasElement => {
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (inputCtx && outputCtx) {
    const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const intensity = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
        const c = intensity > options.threshold ? 255 : 0;
        outputCtx.fillStyle = `rgba(${c}, ${c}, ${c}, ${buf[i + 3]})`;
        outputCtx.fillRect(x, y, 1, 1);
      }
    }
  }

  return output;
};

export default binarize;
