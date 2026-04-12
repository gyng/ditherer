import { ACTION, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { BLUE_NOISE_MAP, BLUE_NOISE_SIZE, BLUE_NOISE_LEVELS } from "./blueNoise64";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  scaleMatrix,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  srgbPaletteGetColor,
  linearPaletteGetColor,
  wasmQuantizeBuffer
} from "utils";

export const BAYER_2X2 = "BAYER_2X2";
export const BAYER_3X3 = "BAYER_3X3";
export const BAYER_4X4 = "BAYER_4X4";
export const BAYER_8X8 = "BAYER_8X8";
export const BAYER_16X16 = "BAYER_16X16";
export const SQUARE_5X5 = "SQUARE_5X5";
export const CORNER_4X4 = "CORNER_4X4";
export const BLOCK_VERTICAL_4X4 = "BLOCK_VERTICAL_4X4";
export const BLOCK_HORIZONTAL_4X4 = "BLOCK_HORIZONTAL_4X4";
export const HATCH_2X2 = "HATCH_2X2";
export const HATCH_3X3 = "HATCH_3X3";
export const HATCH_4X4 = "HATCH_4X4";
export const ALTERNATE_3X3 = "ALTERNATE_3X3";
export const DISPERSED_DOT_3X3 = "DISPERSED_DOT_3X3";
export const PATTERN_5X5 = "PATTERN_5X5";
export const BLUE_NOISE_16X16 = "BLUE_NOISE_16X16";
export const BLUE_NOISE_64X64 = "BLUE_NOISE_64X64";

// map[y][x]
const thresholdMaps = {
  [BAYER_2X2]: {
    width: 2,
    thresholdMap: scaleMatrix([[0, 2], [3, 1]], 1 / 4)
  },
  [BAYER_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix([[0, 7, 3], [6, 5, 2], [4, 1, 8]], 1 / 9)
  },
  [BAYER_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
      1 / 16
    )
  },
  [BAYER_8X8]: {
    width: 8,
    thresholdMap: scaleMatrix(
      [
        [0, 48, 12, 60, 3, 51, 15, 63],
        [32, 16, 44, 28, 35, 19, 47, 31],
        [8, 56, 4, 52, 11, 59, 7, 55],
        [40, 24, 36, 20, 43, 27, 39, 23],
        [2, 50, 14, 62, 1, 49, 13, 61],
        [34, 18, 46, 30, 33, 17, 45, 29],
        [10, 58, 6, 54, 9, 57, 5, 53],
        [42, 26, 38, 22, 41, 25, 37, 21]
      ],
      1 / 64
    )
  },
  [BAYER_16X16]: {
    width: 16,
    thresholdMap: scaleMatrix(
      // prettier-ignore
      [
        [   0,192, 48,240, 12,204, 60,252,  3,195, 51,243, 15,207, 63,255 ],
        [ 128, 64,176,112,140, 76,188,124,131, 67,179,115,143, 79,191,127 ],
        [  32,224, 16,208, 44,236, 28,220, 35,227, 19,211, 47,239, 31,223 ],
        [ 160, 96,144, 80,172,108,156, 92,163, 99,147, 83,175,111,159, 95 ],
        [   8,200, 56,248,  4,196, 52,244, 11,203, 59,251,  7,199, 55,247 ],
        [ 136, 72,184,120,132, 68,180,116,139, 75,187,123,135, 71,183,119 ],
        [  40,232, 24,216, 36,228, 20,212, 43,235, 27,219, 39,231, 23,215 ],
        [ 168,104,152, 88,164,100,148, 84,171,107,155, 91,167,103,151, 87 ],
        [   2,194, 50,242, 14,206, 62,254,  1,193, 49,241, 13,205, 61,253 ],
        [ 130, 66,178,114,142, 78,190,126,129, 65,177,113,141, 77,189,125 ],
        [  34,226, 18,210, 46,238, 30,222, 33,225, 17,209, 45,237, 29,221 ],
        [ 162, 98,146, 82,174,110,158, 94,161, 97,145, 81,173,109,157, 93 ],
        [  10,202, 58,250,  6,198, 54,246,  9,201, 57,249,  5,197, 53,245 ],
        [ 138, 74,186,122,134, 70,182,118,137, 73,185,121,133, 69,181,117 ],
        [  42,234, 26,218, 38,230, 22,214, 41,233, 25,217, 37,229, 21,213 ],
        [ 170,106,154, 90,166,102,150, 86,169,105,153, 89,165,101,149, 85]
      ],
      1 / 256
    )
  },
  [SQUARE_5X5]: {
    width: 5,
    thresholdMap: scaleMatrix(
      [
        [40, 60, 150, 90, 10],
        [80, 170, 240, 200, 110],
        [140, 210, 250, 220, 130],
        [120, 190, 230, 180, 70],
        [20, 100, 160, 50, 30]
      ],
      1 / 255
    )
  },
  [DISPERSED_DOT_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix([[0, 6, 3], [4, 7, 2], [5, 1, 8]], 1 / 9)
  },
  [CORNER_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [[0, 2, 5, 9], [1, 4, 8, 12], [3, 7, 11, 14], [6, 10, 13, 15]],
      1 / 16
    )
  },
  [BLOCK_VERTICAL_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
      1 / 4
    ),
    levels: 4
  },
  [BLOCK_HORIZONTAL_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]],
      1 / 4
    ),
    levels: 4
  },
  [HATCH_2X2]: {
    width: 2,
    thresholdMap: scaleMatrix([[0, 1], [1, 0]], 1 / 2),
    levels: 2
  },
  [HATCH_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix([[0, 1, 2], [1, 2, 1], [2, 1, 0]], 1 / 3),
    levels: 3
  },
  [HATCH_4X4]: {
    width: 4,
    thresholdMap: scaleMatrix(
      [[0, 1, 2, 3], [1, 2, 3, 2], [2, 3, 2, 1], [3, 2, 1, 0]],
      1 / 4
    ),
    levels: 4
  },
  [ALTERNATE_3X3]: {
    width: 3,
    thresholdMap: scaleMatrix([[0, 5, 1], [6, 2, 7], [3, 8, 4]], 1 / 9),
    levels: 9
  },
  [PATTERN_5X5]: {
    width: 5,
    thresholdMap: scaleMatrix(
      [
        [2, 4, 2, 4, 2],
        [4, 1, 3, 1, 4],
        [2, 3, 0, 3, 2],
        [4, 1, 3, 1, 4],
        [2, 4, 2, 4, 2]
      ],
      1 / 5
    ),
    levels: 5
  },
  // Pre-computed 16×16 blue noise — fast, good for small/pixelated output
  [BLUE_NOISE_16X16]: {
    width: 16,
    thresholdMap: scaleMatrix([
      [120, 24, 200, 80, 160, 40, 240, 8, 136, 56, 184, 96, 216, 32, 176, 72],
      [48, 232, 144, 16, 112, 208, 88, 168, 104, 224, 12, 152, 64, 128, 248, 192],
      [192, 68, 100, 252, 180, 60, 148, 28, 244, 76, 164, 212, 44, 108, 20, 140],
      [132, 172, 36, 220, 132, 4, 236, 116, 52, 188, 36, 92, 228, 172, 84, 52],
      [4, 84, 156, 52, 96, 196, 72, 180, 140, 100, 252, 132, 156, 0, 204, 244],
      [244, 204, 116, 228, 28, 164, 124, 44, 216, 20, 68, 196, 40, 120, 60, 160],
      [56, 148, 8, 176, 248, 84, 252, 92, 152, 240, 108, 176, 88, 236, 148, 28],
      [184, 104, 72, 140, 60, 212, 12, 200, 60, 128, 48, 220, 12, 184, 100, 208],
      [36, 224, 188, 20, 112, 168, 108, 168, 232, 84, 168, 144, 72, 52, 124, 72],
      [128, 160, 44, 240, 200, 32, 76, 40, 4, 200, 24, 96, 248, 200, 16, 252],
      [80, 252, 96, 64, 152, 244, 136, 224, 120, 148, 244, 56, 160, 108, 176, 40],
      [212, 16, 136, 188, 88, 48, 180, 56, 92, 212, 76, 184, 28, 228, 136, 88],
      [112, 168, 204, 8, 124, 228, 100, 160, 28, 172, 116, 232, 64, 152, 48, 196],
      [60, 40, 236, 76, 196, 16, 68, 248, 132, 52, 252, 140, 96, 4, 216, 120],
      [144, 188, 104, 156, 52, 144, 204, 36, 216, 84, 12, 192, 44, 248, 80, 24],
      [24, 220, 68, 244, 116, 84, 176, 112, 188, 160, 100, 72, 168, 124, 164, 232]
    ], 1 / 256),
    levels: 256
  },
  // 64×64 blue noise generated via void-and-cluster algorithm
  // Best quality — organic, film-grain-like dithering with no visible tiling
  [BLUE_NOISE_64X64]: {
    width: BLUE_NOISE_SIZE,
    thresholdMap: BLUE_NOISE_MAP,
    levels: BLUE_NOISE_LEVELS
  }
};

const scaleThresholdMap = (
  map: number[][],
  timesX: number,
  timesY: number
) => {
  if (timesX === 1 && timesY === 1) {
    return map;
  }

  const out: number[][] = [];

  for (let i = 0; i < map.length; i += 1) {
    for (let y = 0; y < timesY; y += 1) {
      const row: number[] = [];

      for (let j = 0; j < map[i].length; j += 1) {
        for (let x = 0; x < timesX; x += 1) {
          row.push(map[i][j]);
        }
      }
      out.push(row);
    }
  }

  return out;
};

// Scratch buffer reused across getOrderedColor calls — avoids per-pixel allocations
const _orderedOut = [0, 0, 0, 0];

const getOrderedColor = (
  color: number[],
  levels: number,
  tx: number,
  ty: number,
  threshold: number[][]
) => {
  const thresholdValue = threshold[ty][tx];

  if (thresholdValue == null) {
    _orderedOut[0] = 255; _orderedOut[1] = 255; _orderedOut[2] = 0; _orderedOut[3] = 255;
    return _orderedOut;
  }

  const step = 255 / (levels - 1);
  const bias = step * (thresholdValue - 0.5);

  _orderedOut[0] = Math.round(Math.round((color[0] + bias) / step) * step);
  _orderedOut[1] = Math.round(Math.round((color[1] + bias) / step) * step);
  _orderedOut[2] = Math.round(Math.round((color[2] + bias) / step) * step);
  _orderedOut[3] = color[3];
  return _orderedOut;
};

type OrderedPalette = {
  options?: {
    levels?: number;
    colors?: number[][];
    colorDistanceAlgorithm?: string;
  } & FilterOptionValues;
} & Record<string, unknown>;

type OrderedOptions = FilterOptionValues & {
  palette?: OrderedPalette;
  thresholdMap?: keyof typeof thresholdMaps;
  thresholdMapScaleX?: number;
  thresholdMapScaleY?: number;
  temporalPhases?: number;
  animSpeed?: number;
  _frameIndex?: number;
  _linearize?: boolean;
  _wasmAcceleration?: boolean;
};

export const optionTypes = {
  thresholdMap: {
    type: ENUM,
    options: [
      {
        name: "Bayer 2×2",
        value: BAYER_2X2
      },
      {
        name: "Bayer 3×3",
        value: BAYER_3X3
      },
      {
        name: "Bayer 4×4",
        value: BAYER_4X4
      },
      {
        name: "Bayer 8×8",
        value: BAYER_8X8
      },
      {
        name: "Bayer 16×16",
        value: BAYER_16X16
      },
      {
        name: "Dispersed Dot 3×3",
        value: DISPERSED_DOT_3X3
      },
      {
        name: "Digital Halftone 5×8",
        value: SQUARE_5X5
      },
      {
        name: "Corner 4×4",
        value: CORNER_4X4
      },
      {
        name: "Block Vertical 4×4",
        value: BLOCK_VERTICAL_4X4
      },
      {
        name: "Block Horizontal 4×4",
        value: BLOCK_HORIZONTAL_4X4
      },
      {
        name: "Hatch 2×2",
        value: HATCH_2X2
      },
      {
        name: "Hatch 3×3",
        value: HATCH_3X3
      },
      {
        name: "Hatch 4×4",
        value: HATCH_4X4
      },
      {
        name: "Alternate 3×3",
        value: ALTERNATE_3X3
      },
      {
        name: "Hatch 2×2 ×3",
        value: PATTERN_5X5
      },
      {
        name: "Blue Noise 16×16",
        value: BLUE_NOISE_16X16
      },
      {
        name: "Blue Noise 64×64",
        value: BLUE_NOISE_64X64
      }
    ],
    default: HATCH_2X2,
    desc: "Dither pattern — larger matrices produce smoother gradients"
  },
  thresholdMapScaleX: { type: RANGE, range: [1, 5], step: 1, default: 1, desc: "Stretch the dither pattern horizontally" },
  thresholdMapScaleY: { type: RANGE, range: [1, 5], step: 1, default: 1, desc: "Stretch the dither pattern vertically" },
  temporalPhases: { type: RANGE, range: [1, 8], step: 1, default: 1, desc: "Cycle threshold offset across frames — higher = more perceived colors over time" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
  palette: { type: PALETTE, default: nearest }
};

const defaultThresholdMap = optionTypes.thresholdMap.default as keyof typeof thresholdMaps;

const defaults: OrderedOptions = {
  thresholdMap: defaultThresholdMap,
  thresholdMapScaleX: optionTypes.thresholdMapScaleX.default,
  thresholdMapScaleY: optionTypes.thresholdMapScaleY.default,
  temporalPhases: optionTypes.temporalPhases.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const ordered = (
  input: any,
  options: OrderedOptions = defaults
) => {
  const palette = options.palette ?? defaults.palette;
  const thresholdMapKey = options.thresholdMap ?? defaultThresholdMap;
  const thresholdMapScaleX =
    typeof options.thresholdMapScaleX === "number"
      ? options.thresholdMapScaleX
      : defaults.thresholdMapScaleX ?? 1;
  const thresholdMapScaleY =
    typeof options.thresholdMapScaleY === "number"
      ? options.thresholdMapScaleY
      : defaults.thresholdMapScaleY ?? 1;
  const temporalPhases =
    typeof options.temporalPhases === "number"
      ? options.temporalPhases
      : defaults.temporalPhases ?? 1;
  const frameIndex = typeof options._frameIndex === "number" ? options._frameIndex : 0;

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const threshold = thresholdMaps[thresholdMapKey] as {
    width: number;
    thresholdMap: number[][];
    levels?: number;
  };
  const explicitLevels = "levels" in threshold ? threshold.levels : undefined;
  const levels = explicitLevels || threshold.width * threshold.width;
  const thresholdMapScaled = scaleThresholdMap(
    threshold.thresholdMap,
    thresholdMapScaleX,
    thresholdMapScaleY
  );
  const thresholdMapWidth = threshold.width * thresholdMapScaleX;
  const thresholdMapHeight = threshold.width * thresholdMapScaleY;

  // Temporal dither: offset threshold map position per frame
  const phase = temporalPhases > 1 ? (frameIndex % temporalPhases) : 0;
  const temporalOffsetX = temporalPhases > 1 ? Math.floor(phase * thresholdMapWidth / temporalPhases) : 0;
  const temporalOffsetY = temporalPhases > 1 ? Math.floor(phase * thresholdMapHeight / temporalPhases) : 0;

  if (options._linearize && palette) {
    const floatBuf = srgbBufToLinearFloat(buf);
    const stepF = 1.0 / (levels - 1);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const tix = (x + temporalOffsetX) % thresholdMapWidth;
        const tiy = (y + temporalOffsetY) % thresholdMapHeight;
        const i = getBufferIndex(x, y, input.width);
        const thresholdValue = thresholdMapScaled[tiy][tix];

        const bias = stepF * (thresholdValue - 0.5);
        _orderedOut[0] = Math.round(Math.round((floatBuf[i] + bias) / stepF) * stepF * 1e6) / 1e6;
        _orderedOut[1] = Math.round(Math.round((floatBuf[i + 1] + bias) / stepF) * stepF * 1e6) / 1e6;
        _orderedOut[2] = Math.round(Math.round((floatBuf[i + 2] + bias) / stepF) * stepF * 1e6) / 1e6;
        _orderedOut[3] = floatBuf[i + 3];
        const orderedColor = _orderedOut;

        const color = linearPaletteGetColor(palette, orderedColor, palette.options);
        fillBufferPixel(floatBuf, i, color[0], color[1], color[2], floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    // Apply thresholds to all pixels
    const W = input.width;
    const H = input.height;
    const ditheredBuf = new Uint8Array(buf.length);
    const _pix = [0, 0, 0, 0];
    for (let x = 0; x < W; x += 1) {
      for (let y = 0; y < H; y += 1) {
        const i = getBufferIndex(x, y, W);
        _pix[0] = buf[i]; _pix[1] = buf[i + 1]; _pix[2] = buf[i + 2]; _pix[3] = buf[i + 3];
        const oc = getOrderedColor(_pix, levels, (x + temporalOffsetX) % thresholdMapWidth, (y + temporalOffsetY) % thresholdMapHeight, thresholdMapScaled);
        ditheredBuf[i] = oc[0]; ditheredBuf[i + 1] = oc[1];
        ditheredBuf[i + 2] = oc[2]; ditheredBuf[i + 3] = oc[3];
      }
    }

    // WASM buffer quantize on the dithered pixels — single call
    const algo = palette?.options?.colorDistanceAlgorithm;
    const wasmResult = options._wasmAcceleration && algo && palette?.options?.colors
      ? wasmQuantizeBuffer(ditheredBuf, palette.options.colors, algo)
      : null;

    if (wasmResult) {
      buf.set(wasmResult);
    } else {
      // JS fallback — per-pixel palette match
      const _palPix = [0, 0, 0, 0];
      for (let x = 0; x < W; x += 1) {
        for (let y = 0; y < H; y += 1) {
          const i = getBufferIndex(x, y, W);
          _palPix[0] = ditheredBuf[i]; _palPix[1] = ditheredBuf[i + 1];
          _palPix[2] = ditheredBuf[i + 2]; _palPix[3] = ditheredBuf[i + 3];
          const color = srgbPaletteGetColor(palette, _palPix, palette?.options);
          fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Ordered",
  func: ordered,
  options: defaults,
  optionTypes,
  defaults
});
