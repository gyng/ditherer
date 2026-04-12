import { BOOL, ENUM, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import * as palettes from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  rgba2hsvaMemo,
  rgba2labaMemo,
  luminance,
  srgbPaletteGetColor
} from "utils";

export const DIRECTION = {
  COLUMN: "COLUMN",
  ROW: "ROW",
  CIRCULAR: "CIRCULAR",
  SPIRAL: "SPIRAL",
  SPIRAL_CUT: "SPIRAL_CUT",
  DIAGONAL_TOP_RIGHT: "DIAGONAL_TOP_RIGHT"
};
export const SORT_DIRECTION = {
  ASCENDING: "ASCENDING",
  DESCENDING: "DESCENDING"
};

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

const compareQuadlet = (
  a,
  b,
  dir
) => {
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

export const SORTS = {
  [COMPARATOR.RGBA]: compareQuadlet,
  [COMPARATOR.GBRA]: (a, b, dir) => {
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.BGRA]: (a, b, dir) => {
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.HSVA]: (
    aRgba,
    bRgba,
    dir
  ) => {
    const a = rgba2hsvaMemo(aRgba);
    const b = rgba2hsvaMemo(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [COMPARATOR.SVHA]: (
    aRgba,
    bRgba,
    dir
  ) => {
    const a = rgba2hsvaMemo(aRgba);
    const b = rgba2hsvaMemo(bRgba);
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.VSHA]: (
    aRgba,
    bRgba,
    dir
  ) => {
    const a = rgba2hsvaMemo(aRgba);
    const b = rgba2hsvaMemo(bRgba);
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.LABA]: (
    aRgba,
    bRgba,
    dir
  ) => {
    const a = rgba2labaMemo(aRgba);
    const b = rgba2labaMemo(bRgba);
    return compareQuadlet(a, b, dir);
  },
  [COMPARATOR.ABLA]: (
    aRgba,
    bRgba,
    dir
  ) => {
    const a = rgba2labaMemo(aRgba);
    const b = rgba2labaMemo(bRgba);
    const ap = [a[1], a[2], a[0], a[3]];
    const bp = [b[1], b[2], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.BALA]: (
    aRgba,
    bRgba,
    dir
  ) => {
    const a = rgba2labaMemo(aRgba);
    const b = rgba2labaMemo(bRgba);
    const ap = [a[2], a[1], a[0], a[3]];
    const bp = [b[2], b[1], b[0], b[3]];
    return compareQuadlet(ap, bp, dir);
  },
  [COMPARATOR.LUMINANCE]: (a, b, dir, linear = true) => {
    const dirMul = dir === SORT_DIRECTION.ASCENDING ? 1 : -1;
    const lumA = luminance(a, linear);
    const lumB = luminance(b, linear);
    return (lumA - lumB) * dirMul;
  }
};

const spiralIterator = endIntervalOnTurn => init => {
  let { x, y, i } = init;
  const { w, h } = init;
  x += Math.floor(w / 2);
  y += Math.floor(h / 2);
  i = getBufferIndex(x, y, w);

  let end = false;
  let endInterval = false;
  const maxIterations = w * h;
  let iterations = 0;

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
    if (end || iterations >= maxIterations) {
      return null;
    }
    iterations += 1;

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
    end = end || i >= w * h * 4;
    if (x < 0 || y < 0 || x >= w || y >= h) {
      return null;
    }

    return nextResult;
  };
};

// Circular iterator: concentric rings from center, each ring is one interval
const circularIterator = init => {
  const { w, h } = init;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.ceil(Math.sqrt(cx * cx + cy * cy));

  // Pre-compute all pixels sorted by radius, with ring boundaries
  const pixels: { x: number; y: number; r: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      pixels.push({ x, y, r });
    }
  }
  // Sort by radius, then by angle for consistent ring ordering
  pixels.sort((a, b) => {
    const dr = a.r - b.r;
    if (Math.abs(dr) > 0.5) return dr;
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    return angA - angB;
  });

  let idx = 0;
  const ringWidth = Math.max(1, maxR / Math.min(w, h) * 3);

  return () => {
    if (idx >= pixels.length) return null;

    const p = pixels[idx];
    const i = getBufferIndex(p.x, p.y, w);

    // End interval when the next pixel crosses into a new ring
    const nextP = idx + 1 < pixels.length ? pixels[idx + 1] : null;
    const endInterval = !nextP || Math.floor(nextP.r / ringWidth) !== Math.floor(p.r / ringWidth);

    idx++;
    return { x: p.x, y: p.y, i, w, h, wrapX: false, wrapY: false, endInterval };
  };
};

// Returns buffer indices
export const ITERATORS = {
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
  [DIRECTION.CIRCULAR]: circularIterator,
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
      { name: "Circular", value: DIRECTION.CIRCULAR },
      { name: "Spiral", value: DIRECTION.SPIRAL },
      { name: "Spiral (non-continuous)", value: DIRECTION.SPIRAL_CUT },
      { name: "Diagonal (top-right)", value: DIRECTION.DIAGONAL_TOP_RIGHT }
    ],
    default: DIRECTION.COLUMN,
    desc: "Pixel traversal direction for sorting"
  },
  sortDirection: {
    type: ENUM,
    options: [
      { name: "Ascending", value: SORT_DIRECTION.ASCENDING },
      { name: "Descending", value: SORT_DIRECTION.DESCENDING }
    ],
    default: SORT_DIRECTION.ASCENDING,
    desc: "Sort order — light-to-dark or dark-to-light"
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
    default: COMPARATOR.LUMINANCE,
    desc: "Color space / channel priority for sorting"
  },
  sortPixelLuminanceAbove: {
    type: RANGE,
    range: [0, 255],
    step: 0.5,
    default: 50,
    desc: "Only sort pixels brighter than this"
  },
  sortPixelLuminanceBelow: {
    type: RANGE,
    range: [0, 255],
    step: 0.5,
    default: 200,
    desc: "Only sort pixels darker than this"
  },
  sortPixelLuminanceChangeAbove: {
    type: RANGE,
    range: [-255, 255],
    step: 1,
    default: -255,
    desc: "Min luminance delta to start a sort interval"
  },
  sortPixelLuminanceChangeBelow: {
    type: RANGE,
    range: [-255, 255],
    step: 1,
    default: 255,
    desc: "Max luminance delta to start a sort interval"
  },
  extraIntervalStartChance: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0,
    desc: "Random chance to break the current sort interval"
  },
  maxIntervalSize: {
    type: RANGE,
    range: [0, 5000],
    step: 1,
    default: 0,
    desc: "Max sorted run length — 0 = unlimited"
  },
  palette: { type: PALETTE, default: palettes.nearest },
  linearLuminance: { type: BOOL, default: false, desc: "Use linear-light luminance instead of sRGB" }
};

export const defaults = {
  direction: optionTypes.direction.default,
  sortDirection: optionTypes.sortDirection.default,
  comparator: optionTypes.comparator.default,
  palette: optionTypes.palette.default,
  linearLuminance: optionTypes.linearLuminance.default,
  sortPixelLuminanceAbove: optionTypes.sortPixelLuminanceAbove.default,
  sortPixelLuminanceBelow: optionTypes.sortPixelLuminanceBelow.default,
  sortPixelLuminanceChangeAbove:
    optionTypes.sortPixelLuminanceChangeAbove.default,
  sortPixelLuminanceChangeBelow:
    optionTypes.sortPixelLuminanceChangeBelow.default,
  extraIntervalStartChance: optionTypes.extraIntervalStartChance.default,
  maxIntervalSize: optionTypes.maxIntervalSize.default
};

type PixelsortPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type PixelsortOptions = FilterOptionValues & {
  direction?: string;
  sortDirection?: string;
  comparator?: string;
  palette?: PixelsortPalette;
  linearLuminance?: boolean;
  sortPixelLuminanceAbove?: number;
  sortPixelLuminanceBelow?: number;
  sortPixelLuminanceChangeAbove?: number;
  sortPixelLuminanceChangeBelow?: number;
  extraIntervalStartChance?: number;
  maxIntervalSize?: number;
};

const pixelsortFilter = (
  input,
  options: PixelsortOptions = defaults
) => {
  const {
    direction,
    sortDirection,
    comparator,
    sortPixelLuminanceAbove,
    sortPixelLuminanceBelow,
    sortPixelLuminanceChangeAbove,
    sortPixelLuminanceChangeBelow,
    extraIntervalStartChance,
    maxIntervalSize,
    palette,
    linearLuminance
  } = options;

  const lum = (pixel) => luminance(pixel, linearLuminance);
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
    interval.pixels.sort((a, b) => SORTS[comparator](a, b, sortDirection, linearLuminance));

    for (let i = 0; i < interval.trail.length; i += 1) {
      const bufIdx = interval.trail[i];
      const pixel = interval.pixels[i];
      const col = srgbPaletteGetColor(palette, pixel, palette.options);
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

   
  while ((cur = iterator())) {
     
    const pixel = rgba(
      buf[cur.i],
      buf[cur.i + 1],
      buf[cur.i + 2],
      buf[cur.i + 3]
    );
    const pixelLum = lum(pixel);
    const lumDelta = lastLum != null ? lastLum - pixelLum : 0;
    lastLum = pixelLum;

    const inLuminosityWindow =
      pixelLum >= sortPixelLuminanceAbove && pixelLum <= sortPixelLuminanceBelow;

    const enoughLuminosityDelta =
      lumDelta >= sortPixelLuminanceChangeAbove &&
      lumDelta <= sortPixelLuminanceChangeBelow;

    if (interval.trail.length > maxIntervalSize && maxIntervalSize > 0) {
      fillInterval();
    }

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

export default defineFilter({
  name: "Pixelsort",
  func: pixelsortFilter,
  optionTypes,
  options: defaults,
  defaults
});
