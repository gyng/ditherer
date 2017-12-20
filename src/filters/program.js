// @flow

import { ENUM, TEXT, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const ALL = "ALL";
export const PIXEL = "PIXEL";

export type Mode = "ALL" | "PIXEL";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [{ name: "Pixel", value: PIXEL }],
    default: PIXEL
  },
  program: {
    type: TEXT,
    default: `// Eval'd JS
// Errors in console
// Variables:
// r, g, b, a
// w, h, x, y
// const p ([r, g, b, a]),
// const i (index),
// input, output

r = r * 0.5;
g = b;
b = i % 255;
a = 255;`
  },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  program: optionTypes.program.default,
  palette: optionTypes.palette.default
};

const programFilter = (
  input: HTMLCanvasElement,
  options: {
    mode: Mode,
    program: string,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const { program, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const w = input.width;
  const h = input.height;

  outside: for (let x = 0; x < w; x += 1) { // eslint-disable-line
    for (let y = 0; y < h; y += 1) {
      // Define variables for program
      const i = getBufferIndex(x, y, w);
      const p = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      /* eslint-disable */
      let r = p[0];
      let g = p[1];
      let b = p[2];
      let a = p[3];

      try {
        eval(program);
      } catch (e) {
        console.error(e);
        break outside;
      }
      /* eslint-enable */

      const col = palette.getColor([r, g, b, a], palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Program",
  func: programFilter,
  optionTypes,
  options: defaults,
  defaults
};
