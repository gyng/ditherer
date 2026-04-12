import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const DIRECTION = {
  NE: "NE",
  NW: "NW",
  SE: "SE",
  SW: "SW"
};

export const optionTypes = {
  depth: { type: RANGE, range: [1, 24], step: 1, default: 8, desc: "How far the pixel slabs extrude in isometric space" },
  direction: {
    type: ENUM,
    options: [
      { name: "North-East", value: DIRECTION.NE },
      { name: "North-West", value: DIRECTION.NW },
      { name: "South-East", value: DIRECTION.SE },
      { name: "South-West", value: DIRECTION.SW }
    ],
    default: DIRECTION.NE,
    desc: "Direction the slabs extrude toward"
  },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 12, desc: "Skip near-black or near-transparent pixels below this luma threshold" },
  shadowColor: { type: COLOR, default: [32, 24, 20], desc: "Color of the extrusion side wall / shadow" },
  shadeFalloff: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "How quickly the side wall fades with depth" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  depth: optionTypes.depth.default,
  direction: optionTypes.direction.default,
  threshold: optionTypes.threshold.default,
  shadowColor: optionTypes.shadowColor.default,
  shadeFalloff: optionTypes.shadeFalloff.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const directionVector = (direction: string) => {
  switch (direction) {
    case DIRECTION.NW: return [-1, -1];
    case DIRECTION.SE: return [1, 1];
    case DIRECTION.SW: return [-1, 1];
    default: return [1, -1];
  }
};

const isometricExtrude = (input, options = defaults) => {
  const { depth, direction, threshold, shadowColor, shadeFalloff, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const [stepX, stepY] = directionVector(direction);

  for (let i = 0; i < outBuf.length; i += 4) outBuf[i + 3] = 0;

  const xStart = stepX > 0 ? width - 1 : 0;
  const xEnd = stepX > 0 ? -1 : width;
  const xStep = stepX > 0 ? -1 : 1;
  const yStart = stepY > 0 ? height - 1 : 0;
  const yEnd = stepY > 0 ? -1 : height;
  const yStep = stepY > 0 ? -1 : 1;

  for (let y = yStart; y !== yEnd; y += yStep) {
    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = getBufferIndex(x, y, width);
      const a = buf[i + 3];
      if (a === 0) continue;

      const lum = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722);
      if (lum < threshold) continue;

      for (let d = depth; d >= 1; d -= 1) {
        const tx = x + stepX * d;
        const ty = y + stepY * d;
        if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;

        const shade = Math.pow(1 - d / (depth + 1), 1 - shadeFalloff);
        const sr = clamp255(shadowColor[0] * (0.4 + shade * 0.6));
        const sg = clamp255(shadowColor[1] * (0.4 + shade * 0.6));
        const sb = clamp255(shadowColor[2] * (0.4 + shade * 0.6));
        fillBufferPixel(outBuf, getBufferIndex(tx, ty, width), sr, sg, sb, a);
      }

      const color = paletteGetColor(
        palette,
        rgba(buf[i], buf[i + 1], buf[i + 2], a),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Isometric Extrude",
  func: isometricExtrude,
  options: defaults,
  optionTypes,
  defaults,
  description: "Project image pixels into stacked isometric slabs with a directional side wall"
});
