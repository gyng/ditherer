// @flow

import type { ColorRGBA } from "types";

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

export type AdaptMode = "AVERAGE" | "MID" | "FIRST";
export const medianCutPalette = (
  buf: Uint8ClampedArray | Uint8Array,
  limit: number,
  ignoreAlpha: boolean,
  adaptMode: AdaptMode
): Array<ColorRGBA> => {
  const range = {
    r: { min: buf[0], max: buf[0] },
    g: { min: buf[0], max: buf[0] },
    b: { min: buf[0], max: buf[0] },
    a: { min: buf[0], max: buf[0] }
  };

  const pixels = [];

  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const a = buf[i + 3];

    range.r.min = r < range.r.min ? r : range.r.min;
    range.r.max = r > range.r.max ? r : range.r.max;

    range.g.min = g < range.g.min ? g : range.g.min;
    range.g.max = g > range.g.max ? g : range.g.max;

    range.b.min = b < range.b.min ? b : range.b.min;
    range.b.max = b > range.b.max ? b : range.b.max;

    range.a.min = a < range.a.min ? a : range.a.min;
    range.a.max = a > range.a.max ? a : range.a.max;

    pixels.push(rgba(r, g, b, a));
  }

  const channelsByRange = [
    { channel: "r", range: range.r.max - range.r.min },
    { channel: "g", range: range.g.max - range.g.min },
    { channel: "b", range: range.b.max - range.b.min },
    { channel: "a", range: range.a.max - range.a.min }
  ].sort((a, b) => b.range - a.range);

  const medianCut = (
    bucket: Array<ColorRGBA>,
    channelSequence: Array<{ channel: string, range: number }>,
    remaining: number,
    iterations: number,
    ignAlpha: boolean,
    adptMode: string
  ): Array<ColorRGBA> => {
    const channel = channelSequence[iterations % (ignAlpha ? 3 : 4)];
    // $FlowFixMe
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

  return medianCut(pixels, channelsByRange, limit, 0, ignoreAlpha, adaptMode);
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

  // color - _Contrast * (color - 1.0) * color *(color - 0.5);

  return [
    (nC[0] + factor * (nC[0] - 1.0) * nC[0] * (nC[0] - 0.5) + 0.5) * 255,
    (nC[1] + factor * (nC[1] - 1.0) * nC[1] * (nC[1] - 0.5) + 0.5) * 255,
    (nC[2] + factor * (nC[2] - 1.0) * nC[2] * (nC[2] - 0.5) + 0.5) * 255,
    color[3]
  ];

  // return [
  //   ((nC[0] - 0.5) * Math.max(factor, 0) + 0.5 + 0.5) * 255,
  //   ((nC[1] - 0.5) * Math.max(factor, 0) + 0.5 + 0.5) * 255,
  //   ((nC[2] - 0.5) * Math.max(factor, 0) + 0.5 + 0.5) * 255,
  //   color[3]
  // ];
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
