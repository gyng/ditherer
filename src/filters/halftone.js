// @flow

import { RANGE, STRING } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex, rgba, quantize } from "./util";

export const optionTypes = {
  size: { type: RANGE, range: [0, Infinity], default: 6 }, // diameter
  offset: { type: RANGE, range: [0, Infinity], default: 0.33 },
  levels: { type: RANGE, range: [0, 255], default: 32 },
  background: { type: STRING, default: "transparent" }
};

const binarize = (
  input: HTMLCanvasElement,
  options: {
    size: number,
    offset: number,
    levels: number,
    background: string
  } = {
    size: optionTypes.size.default,
    offset: optionTypes.offset.default,
    levels: optionTypes.levels.default,
    background: optionTypes.background.default
  }
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

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  outputCtx.globalCompositeOperation = "screen";
  if (typeof options.background === "string") {
    outputCtx.fillStyle = options.background;
    outputCtx.fillRect(0, 0, output.width, output.height);
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  // TODO: handle edges
  for (let x = 0; x < input.width; x += options.size) {
    for (let y = 0; y < input.height; y += options.size) {
      const meanColor = rgba(0, 0, 0, 0);
      const pixels = options.size * options.size;

      for (let w = 0; w < options.size; w += 1) {
        for (let h = 0; h < options.size; h += 1) {
          const sourceIdx = getBufferIndex(x + w, y + h, output.width);

          for (let c = 0; c < 4; c += 1) {
            meanColor[c] += buf[sourceIdx + c] / pixels;
          }
        }
      }

      const quantizedColor = quantize(meanColor, options.levels);
      const radii = quantizedColor.map(c => c * (options.size / 2 / 255));
      const colors = [
        `rgba(255, 0, 0, ${meanColor[3] / 255}`,
        `rgba(0, 255, 0, ${meanColor[3] / 255}`,
        `rgba(0, 0, 255, ${meanColor[3] / 255}`
      ];

      const centerX = x + options.size / 2;
      const centerY = y + options.size / 2;
      const offsetDistance = options.size * options.offset;
      const centers = [
        getOffset(2 * Math.PI / 3, offsetDistance, centerX, centerY),
        getOffset(2 * 2 * Math.PI / 3, offsetDistance, centerX, centerY),
        getOffset(2 * Math.PI, offsetDistance, centerX, centerY)
      ];

      for (let c = 0; c < 3; c += 1) {
        outputCtx.beginPath();
        outputCtx.arc(centers[c][0], centers[c][1], radii[c], 0, Math.PI * 2);
        outputCtx.fillStyle = colors[c];
        outputCtx.fill();
      }
    }
  }

  outputCtx.globalCompositeOperation = "source-over";
  return output;
};

export default binarize;
