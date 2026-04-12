import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const SHAPE = { CIRCLE: "CIRCLE", ELLIPSE: "ELLIPSE" };

export const optionTypes = {
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Maximum darkening amount at the edges" },
  radius: { type: RANGE, range: [0.2, 1.5], step: 0.05, default: 0.8, desc: "Distance from center where darkening begins" },
  softness: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.4, desc: "Width of the transition zone between clear and dark" },
  shape: {
    type: ENUM,
    options: [
      { name: "Circle", value: SHAPE.CIRCLE },
      { name: "Ellipse", value: SHAPE.ELLIPSE }
    ],
    default: SHAPE.ELLIPSE,
    desc: "Vignette shape — ellipse matches the image aspect ratio"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
  softness: optionTypes.softness.default,
  shape: optionTypes.shape.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const vignetteFilter = (input: any, options = defaults) => {
  const { strength, radius, softness, shape, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      let dx = (x / W - 0.5) * 2;
      let dy = (y / H - 0.5) * 2;

      if (shape === SHAPE.ELLIPSE) {
        // Correct for aspect ratio so vignette is elliptical
        const aspect = W / H;
        if (aspect > 1) dx /= aspect;
        else dy *= aspect;
      }

      const dist = Math.sqrt(dx * dx + dy * dy);
      const vign = smoothstep(radius - softness, radius + softness, dist);
      const factor = 1 - vign * strength;

      const r = Math.max(0, Math.min(255, Math.round(buf[i] * factor)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] * factor)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] * factor)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Vignette",
  func: vignetteFilter,
  optionTypes,
  options: defaults,
  defaults
});
