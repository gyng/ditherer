import { RANGE, ENUM } from "constants/controlTypes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, medianCutPalette } from "utils";
import { defineFilter } from "filters/types";

const ADAPT = {
  MID: "MID",
  AVERAGE: "AVERAGE",
  FIRST: "FIRST"
};

const COLOR_MODE = {
  RGB: "RGB",
  LAB: "LAB"
};

const distSq = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const nearestColor = (pixel: number[], palette: number[][]) => {
  let best = palette[0];
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const d = distSq(pixel, color);
    if (d < bestDist) {
      bestDist = d;
      best = color;
    }
  }
  return best;
};

export const optionTypes = {
  levels: { type: RANGE, range: [2, 32], step: 1, default: 8, desc: "Maximum number of colors retained after median-cut palette generation" },
  sampleRate: { type: RANGE, range: [1, 16], step: 1, default: 2, desc: "Use every Nth source pixel when building the adaptive palette" },
  adaptMode: {
    type: ENUM,
    options: [
      { name: "Mid", value: ADAPT.MID },
      { name: "Average", value: ADAPT.AVERAGE },
      { name: "First", value: ADAPT.FIRST }
    ],
    default: ADAPT.MID,
    desc: "How each median-cut bucket is represented in the final palette"
  },
  colorMode: {
    type: ENUM,
    options: [
      { name: "RGB", value: COLOR_MODE.RGB },
      { name: "Lab", value: COLOR_MODE.LAB }
    ],
    default: COLOR_MODE.RGB,
    desc: "Color space used when splitting buckets during palette generation"
  }
};

export const defaults = {
  levels: optionTypes.levels.default,
  sampleRate: optionTypes.sampleRate.default,
  adaptMode: optionTypes.adaptMode.default,
  colorMode: optionTypes.colorMode.default
};

const medianCutFilter = (input: any, options = defaults) => {
  const { levels, sampleRate, adaptMode, colorMode } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const sampled: number[] = [];
  const step = Math.max(1, Math.round(sampleRate));

  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = getBufferIndex(x, y, W);
      sampled.push(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    }
  }

  const palette = medianCutPalette(
    new Uint8ClampedArray(sampled.length > 0 ? sampled : buf),
    Math.max(1, Math.ceil(Math.log2(Math.max(2, levels)))),
    true,
    adaptMode,
    colorMode
  );

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = nearestColor([buf[i], buf[i + 1], buf[i + 2]], palette);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Median Cut",
  func: medianCutFilter,
  optionTypes,
  options: defaults,
  defaults
});
