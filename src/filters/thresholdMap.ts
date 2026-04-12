import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const PATTERN = {
  BAYER_8X8: "BAYER_8X8",
  BAYER_16X16: "BAYER_16X16",
  HALFTONE_DOT: "HALFTONE_DOT",
  DIAGONAL: "DIAGONAL",
  CROSS: "CROSS",
  DIAMOND: "DIAMOND"
};

// 8x8 Bayer matrix
const bayer8 = (() => {
  const m = new Float32Array(64);
  const bayer = (x: number, y: number, size: number): number => {
    if (size === 1) return 0;
    const half = size >> 1;
    const quadrant = (x >= half ? 1 : 0) + (y >= half ? 2 : 0);
    const offsets = [0, 2, 3, 1];
    return offsets[quadrant] + 4 * bayer(x % half, y % half, half);
  };
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      m[y * 8 + x] = bayer(x, y, 8) / 64;
  return m;
})();

// Generate pattern matrices
const generatePattern = (type: string, size: number): { data: Float32Array; w: number; h: number } => {
  const s = size;
  const data = new Float32Array(s * s);

  switch (type) {
    case PATTERN.BAYER_8X8: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++)
          data[y * s + x] = bayer8[(y % 8) * 8 + (x % 8)];
      return { data, w: s, h: s };
    }
    case PATTERN.BAYER_16X16: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const bx = x % 16, by = y % 16;
          const b4 = bayer8[(by % 8) * 8 + (bx % 8)];
          const quadrant = (bx >= 8 ? 1 : 0) + (by >= 8 ? 2 : 0);
          data[y * s + x] = (b4 + [0, 2, 3, 1][quadrant]) / 4;
        }
      return { data, w: s, h: s };
    }
    case PATTERN.HALFTONE_DOT: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const cx = (x % 8) - 3.5, cy = (y % 8) - 3.5;
          data[y * s + x] = Math.sqrt(cx * cx + cy * cy) / 5;
        }
      return { data, w: s, h: s };
    }
    case PATTERN.DIAGONAL: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++)
          data[y * s + x] = ((x + y) % 8) / 8;
      return { data, w: s, h: s };
    }
    case PATTERN.CROSS: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const mx = Math.abs((x % 8) - 3.5);
          const my = Math.abs((y % 8) - 3.5);
          data[y * s + x] = Math.min(mx, my) / 3.5;
        }
      return { data, w: s, h: s };
    }
    case PATTERN.DIAMOND: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const mx = Math.abs((x % 8) - 3.5);
          const my = Math.abs((y % 8) - 3.5);
          data[y * s + x] = (mx + my) / 7;
        }
      return { data, w: s, h: s };
    }
    default:
      data.fill(0.5);
      return { data, w: s, h: s };
  }
};

export const optionTypes = {
  pattern: {
    type: ENUM,
    options: [
      { name: "Bayer 8x8", value: PATTERN.BAYER_8X8 },
      { name: "Bayer 16x16", value: PATTERN.BAYER_16X16 },
      { name: "Halftone dot", value: PATTERN.HALFTONE_DOT },
      { name: "Diagonal", value: PATTERN.DIAGONAL },
      { name: "Cross", value: PATTERN.CROSS },
      { name: "Diamond", value: PATTERN.DIAMOND }
    ],
    default: PATTERN.BAYER_8X8,
    desc: "Threshold pattern shape"
  },
  scale: { type: RANGE, range: [1, 8], step: 1, default: 1, desc: "Pattern tile scale factor" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  pattern: optionTypes.pattern.default,
  scale: optionTypes.scale.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

type ThresholdMapOptions = FilterOptionValues & {
  pattern?: string;
  scale?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
};

const thresholdMap = (input, options: ThresholdMapOptions = defaults) => {
  const { pattern, scale, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const patternSize = 64;
  const { data: patternData, w: pw } = generatePattern(pattern, patternSize);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;

      // Sample threshold from pattern with scale
      const px = Math.floor(x / scale) % pw;
      const py = Math.floor(y / scale) % pw;
      const threshold = patternData[py * pw + px];

      const on = lum > threshold;
      const value = on ? 255 : 0;

      const color = paletteGetColor(palette, rgba(value, value, value, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Threshold Map",
  func: thresholdMap,
  optionTypes,
  options: defaults,
  defaults
});
