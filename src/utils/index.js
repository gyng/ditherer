// @flow

import {
  RGB_NEAREST,
  RGB_APPROX,
  HSV_NEAREST,
  LAB_NEAREST,
  WASM_LAB_NEAREST
} from "constants/color";
import type {
  ColorRGBA,
  ColorLabA,
  ColorHSVA,
  ColorDistanceAlgorithm,
  AppState
} from "types";

export const serializeState = (state: AppState) => JSON.stringify(state);

// https://stackoverflow.com/questions/596216/formula-to-determine-brightness-of-rgb-color
// TODO: make formula an enum
export const luminanceItuBt709 = (c: ColorRGBA) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] * (c[3] / 255);

// ITU BT.601
export const luminance = (c: ColorRGBA) =>
  0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] * (c[3] / 255);

export const quantizeValue = (value: number, levels: number): number => {
  const step = 255 / (levels - 1);
  const bucket = Math.round(value / step);
  return Math.round(bucket * step);
};

export const clamp = (min: number, max: number, value: number): number =>
  Math.max(min, Math.min(max, value));

export const rgba = (r: number, g: number, b: number, a: number): ColorRGBA => [
  r,
  g,
  b,
  a
];

// mutates input
export const equalize = (
  input: Array<number> | Uint8ClampedArray | Uint8Array
): any => {
  let min = input[0];
  let max = input[0];

  for (let i = 1; i < input.length; i += 1) {
    const val = input[i];
    if (i < min) min = val;
    if (i > max) max = val;
  }

  const range = max - min;
  const factor = 256 / range;

  for (let i = 0; i < input.length; i += 1) {
    input[i] = input[i] - min * factor; // eslint-disable-line
  }
};

// http://www.easyrgb.com/en/math.php#text1
export type ReferenceValue = { x: number, y: number, z: number };
export type ReferenceStandard = "CIE_1931" | "CIE_1964";
export const referenceTable: {
  [ReferenceStandard]: { [string]: ReferenceValue }
} = {
  CIE_1931: {
    // 2° (CIE 1931)
    D65: { x: 95.047, y: 100, z: 108.883 }
  },
  CIE_1964: {
    // 10° (CIE 1964)
    D65: { x: 94.811, y: 100, z: 107.304 }
  }
};

// 0-360, 0-1, 0-1, 0-1
export const rgba2hsva = (input: ColorRGBA): ColorHSVA => {
  const r = input[0] / 255;
  const g = input[1] / 255;
  const b = input[2] / 255;
  const a = input[3] / 255;

  let h;
  let s;

  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const delta = max - min;

  const v = max;

  if (delta > 0) {
    s = delta / max;
  } else {
    s = 0;
    h = 0;
    return [h, s, v, a];
  }

  if (r === max) {
    h = (g - b) / delta;
  } else if (g === max) {
    h = 2 + (b - r) / delta;
  } else {
    h = 4 + (r - g) / delta;
  }

  h *= 60;

  if (h < 0) {
    h += 360;
  }

  return [h, s, v, a];
};

// https://stackoverflow.com/questions/7880264/convert-lab-color-to-rgb
// Convert RGB > XYZ > CIE Lab, copying alpha channel
export const rgba2laba = (
  input: ColorRGBA,
  ref: ReferenceValue = referenceTable.CIE_1931.D65
): ColorLabA => {
  let r = input[0] / 255;
  let g = input[1] / 255;
  let b = input[2] / 255;

  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;

  r *= 100;
  g *= 100;
  b *= 100;

  // Observer= 2° (Only use CIE 1931!)
  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;

  x /= ref.x;
  y /= ref.y;
  z /= ref.z;

  x = x > 0.008856 ? x ** (1 / 3) : x * 7.787 + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : y * 7.787 + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : z * 7.787 + 16 / 116;

  const outL = 116 * y - 16;
  const outA = 500 * (x - y);
  const outB = 200 * (y - z);

  return [outL, outA, outB, input[3]];
};

let wasmRgba2labaInner = (a, b, c, d, e, f, g) => {
  console.error("WASM module not loaded!", a, b, c, d, e, f, g); // eslint-disable-line
  return [0, 0, 0, 0];
};

let wasmRgbaLabaDistanceInner = (a, b, c, d, e, f, g, h, i, j, k) => {
  console.error("WASM module not loaded!", a, b, c, d, e, f, g, h, i, j, k); // eslint-disable-line
  return 0;
};

export const wasmRgbaLabaDistance = (
  a: ColorRGBA,
  b: ColorRGBA,
  ref: ReferenceValue = referenceTable.CIE_1931.D65
): number =>
  wasmRgbaLabaDistanceInner(
    a[0],
    a[1],
    a[2],
    a[3],
    b[0],
    b[1],
    b[2],
    b[3],
    ref.x,
    ref.y,
    ref.z
  );

export const wasmRgba2laba = (
  input: ColorRGBA,
  ref: ReferenceValue = referenceTable.CIE_1931.D65
): ColorLabA =>
  // $FlowFixMe
  wasmRgba2labaInner(
    input[0],
    input[1],
    input[2],
    input[3],
    ref.x,
    ref.y,
    ref.z
  );

let wasm;
try {
  wasm = require("wasm/rgba2laba/target/wasm32-unknown-unknown/release/rgba2laba.js"); // eslint-disable-line
  // $FlowFixMe
  require("wasm/rgba2laba/target/wasm32-unknown-unknown/release/rgba2laba.wasm"); // eslint-disable-line

  wasm.then(obj => {
    wasmRgba2labaInner = obj.rgba2laba;
    wasmRgbaLabaDistanceInner = obj.rgbaLabaDistance;
    // console.log(obj, "override");
  });
} catch (e) {
  console.log(e, "Failed to load WASM"); // eslint-disable-line
}

// Convert CIE Lab > XYZ > RGBA, copying alpha channel
export const laba2rgba = (
  input: ColorLabA,
  ref: ReferenceValue = referenceTable.CIE_1931.D65
): ColorRGBA => {
  let y = (input[0] + 16) / 116;
  let x = input[1] / 500 + y;
  let z = y - input[2] / 200;

  y = y ** 3 > 0.008856 ? y ** 3 : (y - 16 / 116) / 7.787;
  x = x ** 3 > 0.008856 ? x ** 3 : (x - 16 / 116) / 7.787;
  z = z ** 3 > 0.008856 ? z ** 3 : (z - 16 / 116) / 7.787;

  // Observer= 2° (Only use CIE 1931!)
  x *= ref.x;
  y *= ref.y;
  z *= ref.z;

  // Normalize
  x /= 100;
  y /= 100;
  z /= 100;

  let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let b = x * 0.0557 + y * -0.204 + z * 1.057;

  r = r > 0.0031308 ? 1.055 * r ** (1 / 2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g;
  b = b > 0.0031308 ? 1.055 * b ** (1 / 2.4) - 0.055 : 12.92 * b;

  r = clamp(0, 255, Math.round(r * 255));
  g = clamp(0, 255, Math.round(g * 255));
  b = clamp(0, 255, Math.round(b * 255));

  return [r, g, b, input[3]];
};

export const colorDistance = (
  a: ColorRGBA,
  b: ColorRGBA,
  colorDistanceAlgorithm: ColorDistanceAlgorithm
): number => {
  switch (colorDistanceAlgorithm) {
    case RGB_NEAREST:
      return Math.sqrt(
        (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
      );
    case LAB_NEAREST: {
      const aLab = rgba2laba(a);
      const bLab = rgba2laba(b);
      return Math.sqrt(
        (bLab[0] - aLab[0]) ** 2 +
          (bLab[1] - aLab[1]) ** 2 +
          (bLab[2] - aLab[2]) ** 2
      );
    }
    case WASM_LAB_NEAREST: {
      return wasmRgbaLabaDistance(a, b);
    }
    case RGB_APPROX: {
      const r = (a[0] + b[0]) / 2;
      const dR = a[0] - b[0];
      const dG = a[1] - b[1];
      const dB = a[2] - b[2];

      const dRc = (2 + r / 256) * dR ** 2;
      const dGc = 4 * dG ** 2 + (2 + (255 - r) / 256);
      const dBc = dB ** 2;

      return Math.sqrt(dRc + dGc + dBc);
    }
    case HSV_NEAREST: {
      const aHsv = rgba2hsva(a);
      const bHsv = rgba2hsva(b);
      const dH =
        Math.min(
          Math.abs(bHsv[0] - aHsv[0]),
          360 - Math.abs(bHsv[0] - aHsv[0])
        ) / 180.0;
      const dS = Math.abs(bHsv[1] - aHsv[1]);
      const dV = Math.abs(bHsv[2] - aHsv[2]) / 255.0;

      return Math.sqrt(dH ** 2 + dS ** 2 + dV ** 2);
    }
    default:
      return -1;
  }
};

export type AdaptMode = "AVERAGE" | "MID" | "FIRST";
export type ColorMode = "RGB" | "LAB";
export const medianCutPalette = (
  buf: Uint8ClampedArray | Uint8Array,
  limit: number,
  ignoreAlpha: boolean,
  adaptMode: AdaptMode,
  colorMode: ColorMode = "RGB"
): Array<ColorRGBA> => {
  const range = {
    r: { min: buf[0], max: buf[0] },
    g: { min: buf[0], max: buf[0] },
    b: { min: buf[0], max: buf[0] },
    a: { min: buf[0], max: buf[0] }
  };

  const pixels = [];

  for (let i = 0; i < buf.length; i += 4) {
    const pixelRaw = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    const pixel = colorMode === "RGB" ? pixelRaw : rgba2laba(pixelRaw);

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    const a = pixel[3];

    range.r.min = r < range.r.min ? r : range.r.min;
    range.r.max = r > range.r.max ? r : range.r.max;

    range.g.min = g < range.g.min ? g : range.g.min;
    range.g.max = g > range.g.max ? g : range.g.max;

    range.b.min = b < range.b.min ? b : range.b.min;
    range.b.max = b > range.b.max ? b : range.b.max;

    range.a.min = a < range.a.min ? a : range.a.min;
    range.a.max = a > range.a.max ? a : range.a.max;

    pixels.push(pixel);
  }

  const channelsByRange = [
    { channel: 0, range: range.r.max - range.r.min },
    { channel: 1, range: range.g.max - range.g.min },
    { channel: 2, range: range.b.max - range.b.min },
    { channel: 3, range: range.a.max - range.a.min }
  ].sort((a, b) => b.range - a.range);

  const medianCut = (
    bucket: Array<ColorRGBA>,
    channelSequence: Array<{ channel: number, range: number }>,
    remaining: number,
    iterations: number,
    ignAlpha: boolean,
    adptMode: string
  ): Array<ColorRGBA> => {
    const channel = channelSequence[iterations % (ignAlpha ? 3 : 4)];
    bucket.sort((a, b) => b[channel.channel] - a[channel.channel]);
    const midIdx = Math.floor(bucket.length / 2);

    if (remaining <= 0) {
      switch (adaptMode) {
        case "AVERAGE": {
          const acc = [0, 0, 0, 0];
          bucket.forEach(c => {
            acc[0] += c[0] / bucket.length;
            acc[1] += c[1] / bucket.length;
            acc[2] += c[2] / bucket.length;
            acc[3] += c[3] / bucket.length;
          });
          // $FlowFixMe
          return [acc.map(ch => Math.floor(ch))];
        }
        case "FIRST":
          return [bucket[0]];
        default:
        case "MID":
          return [bucket[midIdx]];
      }
    }

    // Subsort recursively, cycling through channels
    return [bucket.slice(0, midIdx), bucket.slice(midIdx, bucket.length)]
      .map(g =>
        medianCut(
          g,
          channelSequence,
          remaining - 1,
          iterations + 1,
          ignAlpha,
          adptMode
        )
      )
      .reduce((a, b) => a.concat(b), []);
  };

  const paletteRaw = medianCut(
    pixels,
    channelsByRange,
    limit,
    0,
    ignoreAlpha,
    adaptMode
  ).filter(c => c != null);

  if (colorMode === "RGB") {
    return paletteRaw;
  } else if (colorMode === "LAB") {
    return paletteRaw.map(c => laba2rgba(c));
  }

  return [];
};

export const uniqueColors = (
  buf: Uint8ClampedArray | Uint8Array,
  limit: ?number
): Array<ColorRGBA> => {
  const seen: { [string]: { count: number, color: ColorRGBA } } = {};

  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const a = buf[i + 3];

    const key = `${r}-${g}-${b}-${a}`;

    if (seen[key] && seen[key].count) {
      seen[key].count += 1;
    } else {
      seen[key] = {
        count: 1,
        color: rgba(r, g, b, a)
      };
    }
  }

  if (limit) {
    return (
      Object.values(seen)
        .sort((a, b) => {
          if (
            !a ||
            !b ||
            typeof a.count !== "number" ||
            typeof b.count !== "number"
          ) {
            return 0;
          }

          if (a.count < b.count) return -1;
          if (a.count > b.count) return 1;
          return 0;
        })
        .slice(0, limit)
        // $FlowFixMe
        .map(c => c.color)
    );
  }

  // $FlowFixMe
  return Object.values(seen).map(c => c.color);
};

// Preserves nulls
export const scaleMatrix = (
  mat: Array<Array<?number>>,
  scale: number
): Array<Array<?number>> =>
  mat.map(row => row.map(col => (col ? col * scale : col)));

export const add = (a: ColorRGBA, b: ColorRGBA): ColorRGBA => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
  a[3] + b[3]
];

export const sub = (a: ColorRGBA, b: ColorRGBA): ColorRGBA => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
  a[3] - b[3]
];

export const scale = (
  a: ColorRGBA,
  scalar: number,
  alpha: boolean = false
): ColorRGBA => [
  scalar * a[0],
  scalar * a[1],
  scalar * a[2],
  alpha ? scalar * a[3] : a[3]
];

// contrast factor 0-1 ideally
export const contrast = (color: ColorRGBA, factor: number) => {
  // normalise to [-1, 1]
  const nC = [
    color[0] / 255 - 0.5,
    color[1] / 255 - 0.5,
    color[2] / 255 - 0.5,
    color[3]
  ];

  return [
    (nC[0] + factor * (nC[0] - 1.0) * nC[0] * (nC[0] - 0.5) + 0.5) * 255,
    (nC[1] + factor * (nC[1] - 1.0) * nC[1] * (nC[1] - 0.5) + 0.5) * 255,
    (nC[2] + factor * (nC[2] - 1.0) * nC[2] * (nC[2] - 0.5) + 0.5) * 255,
    color[3]
  ];
};

// factor 0-255, exposure ideally 0-2 (small number)
export const brightness = (
  color: ColorRGBA,
  factor: number,
  exposure: number = 1
) => [
  color[0] * exposure + factor,
  color[1] * exposure + factor,
  color[2] * exposure + factor,
  color[3]
];

export const gamma = (color: ColorRGBA, g: number) => [
  255 * (color[0] / 255) ** (1 / g),
  255 * (color[1] / 255) ** (1 / g),
  255 * (color[2] / 255) ** (1 / g),
  color[3]
];

export const getBufferIndex = (x: number, y: number, width: number): number =>
  (x + width * y) * 4;

// FIXME: Make signature consistent with addBufferPixel
export const fillBufferPixel = (
  buf: Uint8ClampedArray | Array<number>,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number
) => {
  buf[i] = r; // eslint-disable-line
  buf[i + 1] = g; // eslint-disable-line
  buf[i + 2] = b; // eslint-disable-line
  buf[i + 3] = a; // eslint-disable-line
};

export const addBufferPixel = (
  buf: Uint8ClampedArray | Array<number>,
  i: number,
  color: ColorRGBA
) => {
  buf[i] += color[0]; // eslint-disable-line
  buf[i + 1] += color[1]; // eslint-disable-line
  buf[i + 2] += color[2]; // eslint-disable-line
  buf[i + 3] += color[3]; // eslint-disable-line
};

export const cloneCanvas = (
  original: HTMLCanvasElement,
  copyData: boolean = true
) => {
  const clone = document.createElement("canvas");

  clone.width = original.width;
  clone.height = original.height;

  const cloneCtx = clone.getContext("2d");

  if (cloneCtx && copyData) {
    cloneCtx.drawImage(original, 0, 0);
  }

  return clone;
};
