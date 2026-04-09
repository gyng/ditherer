import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  scaleX: { type: RANGE, range: [0.1, 4], step: 0.05, default: 1.5 },
  scaleY: { type: RANGE, range: [0.1, 4], step: 0.05, default: 1 },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5 },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scaleX: optionTypes.scaleX.default,
  scaleY: optionTypes.scaleY.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const stretchFilter = (input, options: any = defaults) => {
  const { scaleX, scaleY, centerX, centerY, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const cx = W * centerX, cy = H * centerY;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Map output to input: inverse of scaling
      const sx = cx + (x - cx) / scaleX;
      const sy = cy + (y - cy) / scaleY;

      const di = getBufferIndex(x, y, W);
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) {
        fillBufferPixel(outBuf, di, 0, 0, 0, 255);
        continue;
      }

      // Bilinear sample
      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Stretch", func: stretchFilter, optionTypes, options: defaults, defaults };
