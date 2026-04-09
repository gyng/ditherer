import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const FRACTAL_TYPE = {
  MANDELBROT: "MANDELBROT",
  JULIA: "JULIA"
};

const COLOR_SOURCE = {
  PALETTE: "PALETTE",
  IMAGE: "IMAGE"
};

export const optionTypes = {
  type: {
    type: ENUM,
    options: [
      { name: "Mandelbrot", value: FRACTAL_TYPE.MANDELBROT },
      { name: "Julia", value: FRACTAL_TYPE.JULIA }
    ],
    default: FRACTAL_TYPE.MANDELBROT
  },
  zoom: { type: RANGE, range: [0.1, 50], step: 0.1, default: 1 },
  centerX: { type: RANGE, range: [-2.5, 2.5], step: 0.01, default: -0.5 },
  centerY: { type: RANGE, range: [-2, 2], step: 0.01, default: 0 },
  iterations: { type: RANGE, range: [10, 500], step: 10, default: 100 },
  juliaR: { type: RANGE, range: [-2, 2], step: 0.01, default: -0.7 },
  juliaI: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.27 },
  colorSource: {
    type: ENUM,
    options: [
      { name: "Palette", value: COLOR_SOURCE.PALETTE },
      { name: "Image", value: COLOR_SOURCE.IMAGE }
    ],
    default: COLOR_SOURCE.PALETTE
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  type: optionTypes.type.default,
  zoom: optionTypes.zoom.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  iterations: optionTypes.iterations.default,
  juliaR: optionTypes.juliaR.default,
  juliaI: optionTypes.juliaI.default,
  colorSource: optionTypes.colorSource.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const fractalFilter = (input, options: any = defaults) => {
  const { type, zoom, centerX, centerY, iterations, juliaR, juliaI, colorSource, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const aspect = W / H;
  const rangeX = 3 / zoom;
  const rangeY = rangeX / aspect;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x0 = centerX + (px / W - 0.5) * rangeX;
      const y0 = centerY + (py / H - 0.5) * rangeY;

      let zr: number, zi: number, cr: number, ci: number;

      if (type === FRACTAL_TYPE.JULIA) {
        zr = x0;
        zi = y0;
        cr = juliaR;
        ci = juliaI;
      } else {
        zr = 0;
        zi = 0;
        cr = x0;
        ci = y0;
      }

      let iter = 0;
      while (iter < iterations && zr * zr + zi * zi < 4) {
        const tmp = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = tmp;
        iter++;
      }

      const i = getBufferIndex(px, py, W);

      if (iter === iterations) {
        // Inside the set — black
        fillBufferPixel(outBuf, i, 0, 0, 0, 255);
      } else {
        // Smooth coloring
        const t = (iter + 1 - Math.log2(Math.log2(Math.sqrt(zr * zr + zi * zi)))) / iterations;

        let r: number, g: number, b: number;

        if (colorSource === COLOR_SOURCE.IMAGE) {
          // Use the image as a color lookup
          const srcX = Math.floor(t * W) % W;
          const srcY = Math.floor(t * H) % H;
          const si = getBufferIndex(srcX, srcY, W);
          r = buf[si]; g = buf[si + 1]; b = buf[si + 2];
        } else {
          // Generate colors from iteration count
          const hue = t * 360 * 3; // 3 full cycles
          const sat = 0.9;
          const lit = 0.5;
          const c = (1 - Math.abs(2 * lit - 1)) * sat;
          const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
          const m = lit - c / 2;
          let r1 = 0, g1 = 0, b1 = 0;
          const h = ((hue % 360) + 360) % 360;
          if (h < 60) { r1 = c; g1 = x; }
          else if (h < 120) { r1 = x; g1 = c; }
          else if (h < 180) { g1 = c; b1 = x; }
          else if (h < 240) { g1 = x; b1 = c; }
          else if (h < 300) { r1 = x; b1 = c; }
          else { r1 = c; b1 = x; }
          r = Math.round((r1 + m) * 255);
          g = Math.round((g1 + m) * 255);
          b = Math.round((b1 + m) * 255);
        }

        const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Fractal",
  func: fractalFilter,
  optionTypes,
  options: defaults,
  defaults
};
