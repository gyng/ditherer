import {
  RGB_NEAREST,
  RGB_APPROX,
  HSV_NEAREST,
  LAB_NEAREST,
  WASM_LAB_NEAREST,
  WASM_LAB_NEAREST_MEMO_PALETTE
} from "constants/color";

// --- sRGB ↔ linear conversion (float precision) ---

// LUT: sRGB 0-255 → linear float 0.0-1.0
const SRGB_TO_LINEAR_F = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR_F[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// Linear float → sRGB 0-255
const linearFloatToSrgb = (l) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, s)) * 255);
};

// Convert sRGB Uint8 buffer → Float32Array in linear 0.0-1.0 range
export const srgbBufToLinearFloat = (buf) => {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    out[i]     = SRGB_TO_LINEAR_F[buf[i]];
    out[i + 1] = SRGB_TO_LINEAR_F[buf[i + 1]];
    out[i + 2] = SRGB_TO_LINEAR_F[buf[i + 2]];
    out[i + 3] = buf[i + 3] / 255;
  }
  return out;
};

// Convert linear Float32Array → sRGB Uint8ClampedArray
export const linearFloatToSrgbBuf = (floats, out) => {
  for (let i = 0; i < floats.length; i += 4) {
    out[i]     = linearFloatToSrgb(floats[i]);
    out[i + 1] = linearFloatToSrgb(floats[i + 1]);
    out[i + 2] = linearFloatToSrgb(floats[i + 2]);
    out[i + 3] = Math.round(Math.max(0, Math.min(1, floats[i + 3])) * 255);
  }
};

// Single-color: sRGB [0-255] → linear float [0-1]
export const linearizeColorF = (c) => [
  SRGB_TO_LINEAR_F[c[0]],
  SRGB_TO_LINEAR_F[c[1]],
  SRGB_TO_LINEAR_F[c[2]],
  c[3] / 255
];

// Single-color: linear float [0-1] → sRGB [0-255]
export const delinearizeColorF = (c) => [
  linearFloatToSrgb(c[0]),
  linearFloatToSrgb(c[1]),
  linearFloatToSrgb(c[2]),
  Math.round(Math.max(0, Math.min(1, c[3])) * 255)
];

// --- Legacy 8-bit linearize (kept for simple filters) ---
const SRGB_TO_LINEAR_Q = new Uint8Array(256);
export const LINEAR_TO_SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR_Q[i] = Math.round(SRGB_TO_LINEAR_F[i] * 255);
{
  const buckets = Array.from({ length: 256 }, () => []);
  for (let i = 0; i < 256; i++) buckets[SRGB_TO_LINEAR_Q[i]].push(i);
  for (let q = 0; q < 256; q++) {
    const b = buckets[q];
    LINEAR_TO_SRGB[q] = b.length > 0 ? b[Math.floor(b.length / 2)] : 0;
  }
  LINEAR_TO_SRGB[0] = 0;
  LINEAR_TO_SRGB[255] = 255;
}

export const linearizeBuffer = (buf) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i]     = SRGB_TO_LINEAR_Q[buf[i]];
    buf[i + 1] = SRGB_TO_LINEAR_Q[buf[i + 1]];
    buf[i + 2] = SRGB_TO_LINEAR_Q[buf[i + 2]];
  }
};

export const delinearizeBuffer = (buf) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i]     = LINEAR_TO_SRGB[buf[i]];
    buf[i + 1] = LINEAR_TO_SRGB[buf[i + 1]];
    buf[i + 2] = LINEAR_TO_SRGB[buf[i + 2]];
  }
};

// --- Palette color matching ---

// Palette matching for linearized pipeline.
// Pixel is in linear float 0-1 when isLinear=true.
// Palette colors are always defined in sRGB 0-255.
export const paletteGetColor = (palette, pixel, options, isLinear) => {
  if (!isLinear) return palette.getColor(pixel, options);

  // Convert linear float pixel → sRGB 0-255 for matching
  const srgbPixel = delinearizeColorF(pixel);
  const match = palette.getColor(srgbPixel, options);
  // Convert matched sRGB color → linear float
  return linearizeColorF(match);
};

// For filters that work entirely in sRGB [0-255] space and do NOT implement
// their own linear conversion path. Always quantizes in sRGB regardless of
// the global linearize setting. Use this instead of paletteGetColor to avoid
// the transparent-output bug where linear float [0-1] values get written to
// Uint8ClampedArray as near-zero.
export const srgbPaletteGetColor = (palette, pixel, options) =>
  palette.getColor(pixel, options);

const memoize = (fn) => {
  const cache = new Map();
  return (...args) => {
    const key = String(args[0]);
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
};

const rust = import("wasm/rgba2laba/wasm/rgba2laba");

rust.then(obj => {
  wasmRgba2labaInner = obj.rgba2laba;  
  wasmRgbaLabaDistanceInner = obj.rgba_laba_distance;  
}).catch(err => {
  console.error("WASM module failed to load, using JS fallback:", err);  
});

export const serializeState = (state) => JSON.stringify(state);

// sRGB linearization for gamma-correct luminance
const linearize = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

// https://stackoverflow.com/questions/596216/formula-to-determine-brightness-of-rgb-color
export const luminanceItuBt709 = (
  c,
  linear = true
) => {
  const [r, g, b] = linear
    ? [linearize(c[0]), linearize(c[1]), linearize(c[2])]
    : [c[0] / 255, c[1] / 255, c[2] / 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) * c[3];
};

// ITU BT.601
export const luminance = (
  c,
  linear = true
) => {
  const [r, g, b] = linear
    ? [linearize(c[0]), linearize(c[1]), linearize(c[2])]
    : [c[0] / 255, c[1] / 255, c[2] / 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) * c[3];
};

export const quantizeValue = (value, levels) => {
  const step = 255 / (levels - 1);
  const bucket = Math.round(value / step);
  return Math.round(bucket * step);
};

export const clamp = (min, max, value) =>
  Math.max(min, Math.min(max, value));

export const rgba = (r, g, b, a) => [
  r,
  g,
  b,
  a
];

// mutates input
export const equalize = (
  input
) => {
  let min = input[0];
  let max = input[0];

  for (let i = 1; i < input.length; i += 1) {
    const val = input[i];
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const range = max - min;
  const factor = 256 / range;

  for (let i = 0; i < input.length; i += 1) {
    input[i] = (input[i] - min) * factor;  
  }
};

// http://www.easyrgb.com/en/math.php#text1
export const referenceTable = {
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
export const rgba2hsva = (input) => {
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
  input,
  ref = referenceTable.CIE_1931.D65
) => {
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
  console.error("WASM module not loaded!", a, b, c, d, e, f, g);  
  return [0, 0, 0, 0];
};

let wasmRgbaLabaDistanceInner = (a, b, c, d, e, f, g, h, i, j, k) => {
  console.error("WASM module not loaded!", a, b, c, d, e, f, g, h, i, j, k);  
  return 0;
};


export const wasmRgbaLabaDistance = (
  a,
  b,
  ref = referenceTable.CIE_1931.D65
) =>
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
  input,
  ref = referenceTable.CIE_1931.D65
) =>
  wasmRgba2labaInner(
    input[0],
    input[1],
    input[2],
    input[3],
    ref.x,
    ref.y,
    ref.z
  );

export const wasmRgba2labaMemo = memoize(wasmRgba2laba);

// Convert CIE Lab > XYZ > RGBA, copying alpha channel
export const laba2rgba = (
  input,
  ref = referenceTable.CIE_1931.D65
) => {
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

// a can be assumed to be palette colour
export const colorDistance = (
  a,
  b,
  colorDistanceAlgorithm
) => {
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
    case WASM_LAB_NEAREST_MEMO_PALETTE: {
      const aLab = wasmRgba2labaMemo(a);
      const bLab = rgba2laba(b);
      return Math.sqrt(
        (bLab[0] - aLab[0]) ** 2 +
          (bLab[1] - aLab[1]) ** 2 +
          (bLab[2] - aLab[2]) ** 2
      );
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

export const medianCutPalette = (
  buf,
  limit,
  ignoreAlpha,
  adaptMode,
  colorMode = "RGB"
) => {
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
    bucket,
    channelSequence,
    remaining,
    iterations,
    ignAlpha,
    adptMode
  ) => {
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
  buf,
  limit
) => {
  const seen = {};

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
        .map(c => c.color)
    );
  }

  return Object.values(seen).map(c => c.color);
};

// Preserves nulls
export const scaleMatrix = (
  mat,
  scale
) =>
  mat.map(row => row.map(col => (col ? col * scale : col)));

export const add = (a, b) => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
  a[3] + b[3]
];

export const sub = (a, b) => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
  a[3] - b[3]
];

export const scale = (
  a,
  scalar,
  alpha = false
) => [
  scalar * a[0],
  scalar * a[1],
  scalar * a[2],
  alpha ? scalar * a[3] : a[3]
];

// contrast factor 0-1 ideally
export const contrast = (color, factor) => {
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
  color,
  factor,
  exposure = 1
) => [
  color[0] * exposure + factor,
  color[1] * exposure + factor,
  color[2] * exposure + factor,
  color[3]
];

export const gamma = (color, g) => [
  255 * (color[0] / 255) ** (1 / g),
  255 * (color[1] / 255) ** (1 / g),
  255 * (color[2] / 255) ** (1 / g),
  color[3]
];

export const getBufferIndex = (x, y, width) =>
  (x + width * y) * 4;

// FIXME: Make signature consistent with addBufferPixel
export const fillBufferPixel = (
  buf,
  i,
  r,
  g,
  b,
  a
) => {
  buf[i] = r;  
  buf[i + 1] = g;  
  buf[i + 2] = b;  
  buf[i + 3] = a;  
};

export const addBufferPixel = (
  buf,
  i,
  color
) => {
  buf[i] += color[0];  
  buf[i + 1] += color[1];  
  buf[i + 2] += color[2];  
  buf[i + 3] += color[3];  
};

export const cloneCanvas = (
  original,
  copyData = true
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
