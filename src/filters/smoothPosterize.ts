import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5 },
  smoothness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  smoothness: optionTypes.smoothness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const smoothPosterize = (input, options: any = defaults) => {
  const { levels, smoothness, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const step = 255 / (levels - 1);
  const transitionWidth = step * smoothness * 0.5;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      const quantize = (v: number) => {
        const bandCenter = Math.round(v / step) * step;
        if (transitionWidth < 1) return bandCenter;

        // Distance to nearest band boundary
        const distToEdge = Math.abs(v - bandCenter);
        const halfStep = step / 2;

        if (distToEdge > halfStep - transitionWidth) {
          // In transition zone: smooth interpolation
          const nextBand = v > bandCenter
            ? Math.min(255, bandCenter + step)
            : Math.max(0, bandCenter - step);
          const t = (distToEdge - (halfStep - transitionWidth)) / (transitionWidth * 2);
          const smoothT = t * t * (3 - 2 * t); // smoothstep
          return v > bandCenter
            ? bandCenter + (nextBand - bandCenter) * smoothT
            : bandCenter + (nextBand - bandCenter) * smoothT;
        }
        return bandCenter;
      };

      const r = Math.max(0, Math.min(255, Math.round(quantize(buf[i]))));
      const g = Math.max(0, Math.min(255, Math.round(quantize(buf[i + 1]))));
      const b = Math.max(0, Math.min(255, Math.round(quantize(buf[i + 2]))));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Smooth Posterize", func: smoothPosterize, optionTypes, options: defaults, defaults };
