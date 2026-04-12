import { ENUM, CURVE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const CHANNEL = {
  RGB: "RGB",
  R: "R",
  G: "G",
  B: "B",
  LUMA: "LUMA"
};

const DEFAULT_POINTS = JSON.stringify([
  [0, 0],
  [255, 255]
]);

const parsePoints = (value: string): [number, number][] => {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [[0, 0], [255, 255]];

    const normalized = parsed
      .filter((entry) => Array.isArray(entry) && entry.length >= 2)
      .map((entry) => {
        const rawX = Number(entry[0]);
        const rawY = Number(entry[1]);
        const x = rawX <= 1 && rawY <= 1 ? rawX * 255 : rawX;
        const y = rawX <= 1 && rawY <= 1 ? rawY * 255 : rawY;
        return [
          Math.max(0, Math.min(255, Math.round(x))),
          Math.max(0, Math.min(255, Math.round(y)))
        ] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);

    if (normalized.length < 2) return [[0, 0], [255, 255]];
    if (normalized[0][0] !== 0) normalized.unshift([0, normalized[0][1]]);
    if (normalized[normalized.length - 1][0] !== 255) normalized.push([255, normalized[normalized.length - 1][1]]);
    return normalized;
  } catch {
    return [[0, 0], [255, 255]];
  }
};

const buildCurveLut = (points: [number, number][]) => {
  const lut = new Uint8Array(256);
  let seg = 0;

  for (let x = 0; x < 256; x++) {
    while (seg < points.length - 2 && x > points[seg + 1][0]) seg++;
    const [x0, y0] = points[seg];
    const [x1, y1] = points[Math.min(seg + 1, points.length - 1)];
    const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    lut[x] = Math.max(0, Math.min(255, Math.round(y0 + (y1 - y0) * t)));
  }

  return lut;
};

export const optionTypes = {
  channel: {
    type: ENUM,
    options: [
      { name: "RGB", value: CHANNEL.RGB },
      { name: "Red", value: CHANNEL.R },
      { name: "Green", value: CHANNEL.G },
      { name: "Blue", value: CHANNEL.B },
      { name: "Luma", value: CHANNEL.LUMA }
    ],
    default: CHANNEL.RGB,
    desc: "Which channel is remapped by the curve"
  },
  points: {
    type: CURVE,
    default: DEFAULT_POINTS,
    desc: "Tone curve editor. Points are still stored as JSON pairs for saved chains and URLs."
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  channel: optionTypes.channel.default,
  points: optionTypes.points.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const curves = (input, options = defaults) => {
  const { channel, points, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lut = buildCurveLut(parsePoints(points));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i];
      let g = buf[i + 1];
      let b = buf[i + 2];

      if (channel === CHANNEL.RGB) {
        r = lut[r];
        g = lut[g];
        b = lut[b];
      } else if (channel === CHANNEL.R) {
        r = lut[r];
      } else if (channel === CHANNEL.G) {
        g = lut[g];
      } else if (channel === CHANNEL.B) {
        b = lut[b];
      } else {
        const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const mappedLum = lut[lum];
        const scale = lum === 0 ? mappedLum / 255 : mappedLum / lum;
        r = Math.max(0, Math.min(255, Math.round(r * scale)));
        g = Math.max(0, Math.min(255, Math.round(g * scale)));
        b = Math.max(0, Math.min(255, Math.round(b * scale)));
      }

      const color = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Curves",
  func: curves,
  optionTypes,
  options: defaults,
  defaults
});
