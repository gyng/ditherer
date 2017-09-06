// @flow

import { PALETTE, RANGE, STRING, BOOL } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, rgba } from "utils";

import type { Palette } from "types";

export const optionTypes = {
  size: { type: RANGE, range: [0, Infinity], default: 6 }, // diameter of input
  sizeMultiplier: { type: RANGE, range: [0, 5], step: 0.1, default: 1 }, // diameter of output
  offset: { type: RANGE, range: [0, 3], step: 0.1, default: 0.3 },
  levels: { type: RANGE, range: [0, 255], default: 32 }, // no. of circle sizes
  palette: { type: PALETTE, default: nearest },
  squareDots: { type: BOOL, default: false },
  background: { type: STRING, default: "transparent" }
};

export const defaults = {
  size: optionTypes.size.default,
  sizeMultiplier: optionTypes.sizeMultiplier.default,
  offset: optionTypes.offset.default,
  levels: optionTypes.levels.default,
  palette: { ...optionTypes.palette.default, options: { levels: 8 } },
  squareDots: optionTypes.squareDots.default,
  background: optionTypes.background.default
};

const halftone = (
  input: HTMLCanvasElement,
  options: {
    size: number,
    sizeMultiplier: number,
    offset: number,
    levels: number,
    palette: Palette,
    squareDots: boolean,
    background: string
  } = defaults
): HTMLCanvasElement => {
  const getOffset = (
    radians: number,
    radius: number,
    x0: number,
    y0: number
  ) => {
    const x = x0 + radius * Math.cos(radians);
    const y = y0 + radius * Math.sin(radians);
    return [x, y];
  };
  const { background, palette } = options;
  const size = parseInt(options.size, 10);
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  outputCtx.globalCompositeOperation = "screen";
  if (typeof background === "string") {
    outputCtx.fillStyle = background;
    outputCtx.fillRect(0, 0, output.width, output.height);
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  // TODO: handle edges
  for (let x = 0; x < input.width; x += size) {
    for (let y = 0; y < input.height; y += size) {
      const meanColor = rgba(0, 0, 0, 0);
      const pixels = size * size;

      for (let w = 0; w < size; w += 1) {
        for (let h = 0; h < size; h += 1) {
          const sourceIdx = getBufferIndex(x + w, y + h, output.width);

          for (let c = 0; c < 4; c += 1) {
            meanColor[c] += buf[sourceIdx + c] / pixels;
          }
        }
      }

      // FIXME: this is wrong(?), should apply nearest here and palette later in colors
      // rgba(255, 0, 0) should be matched to red?
      const quantizedColor = palette.getColor(meanColor, palette.options);
      const radii = quantizedColor.map(
        c => c * (size / 2 / 255) * options.sizeMultiplier
      );

      const colors = [
        `rgba(255, 0, 0, ${meanColor[3] / 255}`,
        `rgba(0, 255, 0, ${meanColor[3] / 255}`,
        `rgba(0, 0, 255, ${meanColor[3] / 255}`
      ];

      const centerX = x + size / 2;
      const centerY = y + size / 2;
      const offsetDistance = size * options.offset;
      const centers = [
        getOffset(2 * Math.PI / 3, offsetDistance, centerX, centerY),
        getOffset(2 * 2 * Math.PI / 3, offsetDistance, centerX, centerY),
        getOffset(2 * Math.PI, offsetDistance, centerX, centerY)
      ];

      for (let c = 0; c < 3; c += 1) {
        if (options.squareDots) {
          outputCtx.fillStyle = colors[c];
          outputCtx.fillRect(centers[c][0], centers[c][1], radii[c], radii[c]);
        } else {
          // Circle
          outputCtx.beginPath();
          outputCtx.arc(centers[c][0], centers[c][1], radii[c], 0, Math.PI * 2);
          outputCtx.fillStyle = colors[c];
          outputCtx.fill();
        }
      }
    }
  }

  outputCtx.globalCompositeOperation = "source-over";
  return output;
};

export default {
  name: "Halftone",
  func: halftone,
  options: defaults,
  optionTypes,
  defaults
};
