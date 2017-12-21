// @flow

import { ENUM, RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  rgba2hsva,
  rgba2laba,
  luminance
} from "utils";

import type { ColorRGBA, Palette } from "types";

export const COLUMN = "COLUMN";
export const ROW = "ROW";
export type Direction = "ROW" | "COLUMN";

export const ASCENDING = "ASCENDING";
export const DESCENDING = "DESCENDING";
export type SortDirection = "ASCENDING" | "DESCENDING";

export const SORT_LUMINANCE = "SORT_LUMINANCE";
export const SORT_RGBA = "SORT_RGBA";
export const SORT_GBRA = "SORT_GBRA";
export const SORT_BGRA = "SORT_BGRA";
export const SORT_HSVA = "SORT_HSVA";
export const SORT_VSHA = "SORT_VSHA";
export const SORT_SVHA = "SORT_SVHA";
export const SORT_LABA = "SORT_LABA";
export const SORT_ABLA = "SORT_ABLA";
export const SORT_BALA = "SORT_BALA";
export type Mode =
  | "SORT_RGBA"
  | "SORT_GBRA"
  | "SORT_BGRA"
  | "SORT_LUMINANCE"
  | "SORT_HSVA"
  | "SORT_SVHA"
  | "SORT_VSHA"
  | "SORT_LABA"
  | "SORT_ABLA"
  | "SORT_BALA";

const compareQuadlet = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  dir: SortDirection
): number => {
  const dirMul = dir === ASCENDING ? 1 : -1;
  const rd = (a[0] - b[0]) * dirMul;
  if (rd !== 0) {
    return rd;
  }

  const gd = (a[1] - b[1]) * dirMul;
  if (gd !== 0) {
    return gd;
  }

  const bd = (a[2] - b[2]) * dirMul;
  if (bd !== 0) {
    return bd;
  }

  const ad = (a[3] - b[3]) * dirMul;
  return ad;
};

export const SORTS: {
  [Mode]: (ColorRGBA, ColorRGBA, SortDirection) => number
} = {
  [SORT_RGBA]: compareQuadlet,
  [SORT_GBRA]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [SORT_BGRA]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [SORT_HSVA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [SORT_HSVA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [SORT_SVHA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [SORT_VSHA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [SORT_LABA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2laba(aRgba);
    const b = rgba2laba(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [SORT_ABLA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2laba(aRgba);
    const b = rgba2laba(bRgba);
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [SORT_BALA]: (aRgba: ColorRGBA, bRgba: ColorRGBA, dir: SortDirection) => {
    const a = rgba2laba(aRgba);
    const b = rgba2laba(bRgba);
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [SORT_LUMINANCE]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const dirMul = dir === ASCENDING ? 1 : -1;
    const lumA = luminance(a);
    const lumB = luminance(b);
    return (lumA - lumB) * dirMul;
  }
};

export const optionTypes = {
  direction: {
    type: ENUM,
    options: [{ name: "Row", value: ROW }, { name: "Column", value: COLUMN }],
    default: COLUMN
  },
  sortDirection: {
    type: ENUM,
    options: [
      { name: "Ascending", value: ASCENDING },
      { name: "Descending", value: DESCENDING }
    ],
    default: ASCENDING
  },
  mode: {
    type: ENUM,
    options: [
      { name: "RGBA", value: SORT_RGBA },
      { name: "GBRA", value: SORT_GBRA },
      { name: "BGRA", value: SORT_BGRA },
      { name: "HSVA", value: SORT_HSVA },
      { name: "SVHA", value: SORT_SVHA },
      { name: "VSHA", value: SORT_VSHA },
      { name: "LABA", value: SORT_LABA },
      { name: "ABLA", value: SORT_ABLA },
      { name: "BALA", value: SORT_BALA },
      { name: "Luminance", value: SORT_LUMINANCE }
    ],
    default: SORT_LUMINANCE
  },
  minIntervalLuminosityThreshold: {
    type: RANGE,
    range: [0, 255],
    step: 0.5,
    default: 0
  },
  maxIntervalLuminosityThreshold: {
    type: RANGE,
    range: [0, 255],
    step: 0.5,
    default: 255
  },
  minIntervalLuminosityDelta: {
    type: RANGE,
    range: [-255, 255],
    step: 1,
    default: -255
  },
  maxIntervalLuminosityDelta: {
    type: RANGE,
    range: [-255, 255],
    step: 1,
    default: 255
  },
  randomness: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0
  },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  direction: optionTypes.direction.default,
  sortDirection: optionTypes.sortDirection.default,
  mode: optionTypes.mode.default,
  palette: optionTypes.palette.default,
  minIntervalLuminosityThreshold:
    optionTypes.minIntervalLuminosityThreshold.default,
  maxIntervalLuminosityThreshold:
    optionTypes.maxIntervalLuminosityThreshold.default,
  minIntervalLuminosityDelta: optionTypes.minIntervalLuminosityDelta.default,
  maxIntervalLuminosityDelta: optionTypes.maxIntervalLuminosityDelta.default,
  randomness: optionTypes.randomness.default
};

const programFilter = (
  input: HTMLCanvasElement,
  options: {
    direction: Direction,
    sortDirection: SortDirection,
    mode: Mode,
    minIntervalLuminosityThreshold: number,
    maxIntervalLuminosityThreshold: number,
    minIntervalLuminosityDelta: number,
    maxIntervalLuminosityDelta: number,
    randomness: number,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const {
    direction,
    sortDirection,
    mode,
    minIntervalLuminosityThreshold,
    maxIntervalLuminosityThreshold,
    minIntervalLuminosityDelta,
    maxIntervalLuminosityDelta,
    randomness,
    palette
  } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  let maxPrimary;
  let maxSecondary;

  if (direction === ROW) {
    maxSecondary = input.height;
    maxPrimary = input.width;
  } else {
    maxSecondary = input.width;
    maxPrimary = input.height;
  }

  let intervalStartPrimaryIdx = 0;
  let interval = [];

  const fillInterval = (secondaryIdx: number) => {
    interval.sort((a, b) => SORTS[mode](a, b, sortDirection));

    if (intervalStartPrimaryIdx) {
      for (let k = 0; k < interval.length; k += 1) {
        const pixel = interval[k];
        const primaryIdx = k + intervalStartPrimaryIdx;

        const idx =
          direction === COLUMN
            ? getBufferIndex(secondaryIdx, primaryIdx, input.width)
            : getBufferIndex(primaryIdx, secondaryIdx, input.width);
        const col = palette.getColor(pixel, palette.options);
        fillBufferPixel(buf, idx, col[0], col[1], col[2], col[3]);
      }
    }

    interval = [];
  };

  let lastLum = null;
  for (let i = 0; i < maxSecondary; i += 1) {
    intervalStartPrimaryIdx = 0;

    for (let j = 0; j < maxPrimary; j += 1) {
      const x = direction === ROW ? j : i;
      const y = direction === ROW ? i : j;

      const idx = getBufferIndex(x, y, input.width);
      const pixel = rgba(buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]);
      const lum = luminance(pixel);
      const lumDelta = lastLum != null ? lastLum - lum : 0;
      lastLum = lum;

      if (
        (lum >= minIntervalLuminosityThreshold &&
          lum <= maxIntervalLuminosityThreshold &&
          lumDelta >= minIntervalLuminosityDelta &&
          lumDelta <= maxIntervalLuminosityDelta) ||
        Math.random() < randomness
      ) {
        if (!intervalStartPrimaryIdx) {
          intervalStartPrimaryIdx = j;
        }
        interval.push(pixel);
      } else if (interval.length > 0) {
        fillInterval(i);
        intervalStartPrimaryIdx = 0;
      }
    }

    if (interval.length > 0) {
      fillInterval(i);
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
