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

export const DIRECTION = {
  COLUMN: "COLUMN",
  ROW: "ROW",
  SPIRAL: "SPIRAL",
  SPIRAL_CUT: "SPIRAL_CUT",
  DIAGONAL_TOP_RIGHT: "DIAGONAL_TOP_RIGHT"
};
export type Direction =
  | "ROW"
  | "COLUMN"
  | "DIAGONAL_TOPRIGHT"
  | "SPIRAL"
  | "SPIRAL_CUT";

export const SORT_DIRECTION = {
  ASCENDING: "ASCENDING",
  DESCENDING: "DESCENDING"
};

export type SortDirection = "ASCENDING" | "DESCENDING";

export const COMPARATOR = {
  LUMINANCE: "LUMINANCE",
  RGBA: "RGBA",
  GBRA: "GBRA",
  BGRA: "BGRA",
  HSVA: "HSVA",
  VSHA: "VSHA",
  SVHA: "SVHA",
  LABA: "LABA",
  ABLA: "ABLA",
  BALA: "BALA"
};

export type Comparator =
  | "RGBA"
  | "GBRA"
  | "BGRA"
  | "LUMINANCE"
  | "HSVA"
  | "SVHA"
  | "VSHA"
  | "LABA"
  | "ABLA"
  | "BALA";

const compareQuadlet = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  dir: SortDirection
): number => {
  const dirMul = dir === SORT_DIRECTION.ASCENDING ? 1 : -1;
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
  [Comparator]: (ColorRGBA, ColorRGBA, SortDirection) => number
} = {
  [COMPARATOR.RGBA]: compareQuadlet,
  [COMPARATOR.GBRA]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.BGRA]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.HSVA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [COMPARATOR.HSVA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [COMPARATOR.SVHA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.VSHA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2hsva(aRgba);
    const b = rgba2hsva(bRgba);
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.LABA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2laba(aRgba);
    const b = rgba2laba(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [COMPARATOR.ABLA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2laba(aRgba);
    const b = rgba2laba(bRgba);
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.BALA]: (
    aRgba: ColorRGBA,
    bRgba: ColorRGBA,
    dir: SortDirection
  ) => {
    const a = rgba2laba(aRgba);
    const b = rgba2laba(bRgba);
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.LUMINANCE]: (a: ColorRGBA, b: ColorRGBA, dir: SortDirection) => {
    const dirMul = dir === SORT_DIRECTION.ASCENDING ? 1 : -1;
    const lumA = luminance(a);
    const lumB = luminance(b);
    return (lumA - lumB) * dirMul;
  }
};

export type Iterator = (
  init: any
) => () => ?{
  x: number,
  y: number,
  i: number,
  w: number,
  h: number,
  wrapX: boolean,
  wrapY: boolean,
  endInterval: boolean
};

const spiralIterator = endIntervalOnTurn => init => {
  let { x, y, i } = init;
  const { w, h } = init;
  x += Math.floor(w / 2);
  y += Math.floor(h / 2);
  i = getBufferIndex(x, y, w);

  let end = false;
  let endInterval = false;

  const DIR = {
    N: "N",
    S: "S",
    E: "E",
    W: "W"
  };
  let dir = DIR.S;
  const lengths = {
    [DIR.N]: { cur: 0, max: 2 },
    [DIR.S]: { cur: 0, max: 1 },
    [DIR.E]: { cur: 0, max: 1 },
    [DIR.W]: { cur: 0, max: 2 }
  };

  return () => {
    // debugger;

    if (end) {
      return null;
    }

    const nextResult = {
      x,
      y,
      i,
      w,
      h,
      wrapX: false,
      wrapY: false,
      endInterval
    };

    // Allow fallthrough logic!
    switch (dir) {
      case DIR.N:
        if (lengths[dir].cur >= lengths[dir].max || (y === 0 && x > 0)) {
          lengths[dir].cur = 0;
          lengths[dir].max += 2;
          dir = DIR.W;
          endInterval = endIntervalOnTurn;
        } else {
          lengths[dir].cur += 1;
          y -= 1;
          endInterval = false;
          break;
        }
      case DIR.W: // eslint-disable-line no-fallthrough
        if (lengths[dir].cur >= lengths[dir].max || (x === 0 && y < h)) {
          lengths[dir].cur = 0;
          lengths[dir].max += 2;
          dir = DIR.S;
          endInterval = endIntervalOnTurn;
        } else {
          lengths[dir].cur += 1;
          x -= 1;
          endInterval = false;
          break;
        }
      case DIR.S: // eslint-disable-line no-fallthrough
        if (lengths[dir].cur >= lengths[dir].max || (y === h - 1 && x < h)) {
          lengths[dir].cur = 0;
          lengths[dir].max += 2;
          dir = DIR.E;
          endInterval = endIntervalOnTurn;
        } else {
          lengths[dir].cur += 1;
          y += 1;
          endInterval = false;
          break;
        }
      case DIR.E: // eslint-disable-line no-fallthrough
        if (lengths[dir].cur >= lengths[dir].max || (x === w - 1 && y > 0)) {
          lengths[dir].cur = 0;
          lengths[dir].max += 2;
          dir = DIR.N;
          endInterval = endIntervalOnTurn;
          break;
        } else {
          lengths[dir].cur += 1;
          x += 1;
          endInterval = false;
          break;
        }
      default:
        // last pixel
        end = true;
        break;
    }

    i = getBufferIndex(x, y, w);
    end = end || i >= w * h * 4; // or oob, somehow
    // FIXME: Shouldn't end at (0, 0) but at correct corner
    if (x === 0 && y === 0) {
      return null;
    }

    return nextResult;
  };
};

// Returns buffer indices
export const ITERATORS: { [string]: Iterator } = {
  [DIRECTION.ROW]: init => {
    let { x, y, i } = init;
    const { w, h } = init;
    let end = false;

    return () => {
      if (end) {
        return null;
      }

      const wrapX = x === w;
      const endInterval = wrapX; // Terminate intervals at end
      const nextResult = { x, y, i, w, h, wrapX, wrapY: false, endInterval };

      i = getBufferIndex(x, y, w) + 4;
      end = i >= w * h * 4;

      x = x === w ? 0 : x + 1;
      y = x === w ? y + 1 : y;
      end = y >= h;

      return nextResult;
    };
  },
  [DIRECTION.COLUMN]: init => {
    let { x, y, i } = init;
    const { w, h } = init;
    let end = false;

    return () => {
      if (end) {
        return null;
      }

      const wrapY = y === h;
      const endInterval = wrapY; // Terminate intervals at end
      const nextResult = { x, y, i, w, h, wrapX: false, wrapY, endInterval };

      i = getBufferIndex(x, y, w) + 4;
      end = i >= w * h * 4;

      x = y === h ? x + 1 : x;
      y = y === h ? 0 : y + 1;
      end = x >= w;

      return nextResult;
    };
  },
  [DIRECTION.SPIRAL_CUT]: spiralIterator(true),
  [DIRECTION.SPIRAL]: spiralIterator(false),
  [DIRECTION.DIAGONAL_TOP_RIGHT]: init => {
    let { x, y, i } = init;
    const { w, h } = init;
    let end = false;
    let startX = x;
    let startY = y;

    return () => {
      if (end) {
        return null;
      }

      const wrapY = y === 0;
      const wrapX = x === w - 1;
      const endInterval = wrapY || wrapX;
      const nextResult = { x, y, i, w, h, wrapX, wrapY, endInterval };

      if (x === w - 1 || y === 0) {
        if (startY >= h - 1) {
          startX += 1;
          x = startX;
          y = h - 1;
        } else {
          startY += 1;
          y = startY;
          x = 0;
        }
      } else {
        x += 1;
        y -= 1;
      }

      i = getBufferIndex(x, y, w);
      end = x === w - 1 && y === h - 1;

      return nextResult;
    };
  }
};

export const optionTypes = {
  direction: {
    type: ENUM,
    options: [
      { name: "Row", value: DIRECTION.ROW },
      { name: "Column", value: DIRECTION.COLUMN },
      { name: "Spiral", value: DIRECTION.SPIRAL },
      { name: "Spiral (non-continuous)", value: DIRECTION.SPIRAL_CUT },
      { name: "Diagonal (top-right)", value: DIRECTION.DIAGONAL_TOP_RIGHT }
    ],
    default: DIRECTION.COLUMN
  },
  sortDirection: {
    type: ENUM,
    options: [
      { name: "Ascending", value: SORT_DIRECTION.ASCENDING },
      { name: "Descending", value: SORT_DIRECTION.DESCENDING }
    ],
    default: SORT_DIRECTION.ASCENDING
  },
  comparator: {
    type: ENUM,
    options: [
      { name: "RGBA", value: COMPARATOR.RGBA },
      { name: "GBRA", value: COMPARATOR.GBRA },
      { name: "BGRA", value: COMPARATOR.BGRA },
      { name: "HSVA", value: COMPARATOR.HSVA },
      { name: "SVHA", value: COMPARATOR.SVHA },
      { name: "VSHA", value: COMPARATOR.VSHA },
      { name: "LABA", value: COMPARATOR.LABA },
      { name: "ABLA", value: COMPARATOR.ABLA },
      { name: "BALA", value: COMPARATOR.BALA },
      { name: "Luminance", value: COMPARATOR.LUMINANCE }
    ],
    default: COMPARATOR.LUMINANCE
  },
  sortPixelLuminanceAbove: {
    type: RANGE,
    range: [0, 255],
    step: 0.5,
    default: 0
  },
  sortPixelLuminanceBelow: {
    type: RANGE,
    range: [0, 255],
    step: 0.5,
    default: 255
  },
  sortPixelLuminanceChangeAbove: {
    type: RANGE,
    range: [-255, 255],
    step: 1,
    default: -255
  },
  sortPixelLuminanceChangeBelow: {
    type: RANGE,
    range: [-255, 255],
    step: 1,
    default: 255
  },
  extraIntervalStartChance: {
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
  comparator: optionTypes.comparator.default,
  palette: optionTypes.palette.default,
  sortPixelLuminanceAbove: optionTypes.sortPixelLuminanceAbove.default,
  sortPixelLuminanceBelow: optionTypes.sortPixelLuminanceBelow.default,
  sortPixelLuminanceChangeAbove:
    optionTypes.sortPixelLuminanceChangeAbove.default,
  sortPixelLuminanceChangeBelow:
    optionTypes.sortPixelLuminanceChangeBelow.default,
  extraIntervalStartChance: optionTypes.extraIntervalStartChance.default
};

const pixelsortFilter = (
  input: HTMLCanvasElement,
  options: {
    direction: Direction,
    sortDirection: SortDirection,
    comparator: Comparator,
    sortPixelLuminanceAbove: number,
    sortPixelLuminanceBelow: number,
    sortPixelLuminanceChangeAbove: number,
    sortPixelLuminanceChangeBelow: number,
    extraIntervalStartChance: number,
    palette: Palette
  } = defaults
): HTMLCanvasElement => {
  const {
    direction,
    sortDirection,
    comparator,
    sortPixelLuminanceAbove,
    sortPixelLuminanceBelow,
    sortPixelLuminanceChangeAbove,
    sortPixelLuminanceChangeBelow,
    extraIntervalStartChance,
    palette
  } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const newInterval = () => ({ trail: [], pixels: [] });
  let interval = newInterval();

  const fillInterval = () => {
    interval.pixels.sort((a, b) => SORTS[comparator](a, b, sortDirection));

    for (let i = 0; i < interval.trail.length; i += 1) {
      const bufIdx = interval.trail[i];
      const pixel = interval.pixels[i];
      const col = palette.getColor(pixel, palette.options);
      fillBufferPixel(buf, bufIdx, col[0], col[1], col[2], col[3]);
    }

    interval = newInterval();
  };

  let lastLum = null;
  let cur;
  const iterator = ITERATORS[direction]({
    i: 0,
    x: 0,
    y: 0,
    w: input.width,
    h: input.height
  });

  /* eslint-disable */
  while ((cur = iterator())) {
    /* eslint-enable */
    const pixel = rgba(
      buf[cur.i],
      buf[cur.i + 1],
      buf[cur.i + 2],
      buf[cur.i + 3]
    );
    const lum = luminance(pixel);
    const lumDelta = lastLum != null ? lastLum - lum : 0;
    lastLum = lum;

    const inLuminosityWindow =
      lum >= sortPixelLuminanceAbove && lum <= sortPixelLuminanceBelow;

    const enoughLuminosityDelta =
      lumDelta >= sortPixelLuminanceChangeAbove &&
      lumDelta <= sortPixelLuminanceChangeBelow;

    if (
      (inLuminosityWindow && enoughLuminosityDelta) ||
      Math.random() < extraIntervalStartChance
    ) {
      interval.pixels.push(pixel);
      interval.trail.push(cur.i);

      // If iterator forces an end of an interval (eg. x wrapped around)
      if (cur.endInterval) {
        fillInterval();
      }
    } else if (interval.trail.length > 0) {
      fillInterval();
    }
  }

  // Clean up any remaining interval
  if (interval.trail.length > 0) {
    fillInterval();
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Pixelsort",
  func: pixelsortFilter,
  optionTypes,
  options: defaults,
  defaults
};
