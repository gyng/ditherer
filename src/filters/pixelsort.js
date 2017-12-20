// @flow

import { ENUM, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
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
export type Mode = "SORT_RGBA" | "SORT_LUMINANCE";

export const SORTS: {
  [Mode]: (ColorRGBA, ColorRGBA, SortDirection) => number
} = {
  [SORT_RGBA]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const dirMul = dir === ASCENDING ? 1 : -1;
    const rd = (a[0] - a[1]) * dirMul;
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
    default: DESCENDING
  },
  mode: {
    type: ENUM,
    options: [
      { name: "RGBA", value: SORT_RGBA },
      { name: "Luminance", value: SORT_LUMINANCE }
    ],
    default: SORT_LUMINANCE
  },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  direction: optionTypes.direction.default,
  sortDirection: optionTypes.sortDirection.default,
  mode: optionTypes.mode.default,
  palette: optionTypes.palette.default
};

const programFilter = (
  input: HTMLCanvasElement,
  options: {
    direction: Direction,
    sortDirection: SortDirection,
    mode: Mode,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const { direction, sortDirection, mode, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (direction === ROW) {
    for (let y = 0; y < input.height; y += 1) {
      let row = [];
      for (let x = 0; x < input.width; x += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        row.push(pixel);
      }
      row = row.sort((a, b) => SORTS[mode](a, b, sortDirection));

      for (let x = 0; x < input.width; x += 1) {
        const pixel = row[x];
        const i = getBufferIndex(x, y, input.width);
        const col = palette.getColor(pixel, palette.options);
        fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
      }
    }
  } else if (direction === COLUMN) {
    for (let x = 0; x < input.width; x += 1) {
      let column = [];
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        column.push(pixel);
      }
      column = column.sort((a, b) => SORTS[mode](a, b, sortDirection));

      for (let y = 0; y < input.height; y += 1) {
        const pixel = column[y];
        const i = getBufferIndex(x, y, input.width);
        const col = palette.getColor(pixel, palette.options);
        fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
      }
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
