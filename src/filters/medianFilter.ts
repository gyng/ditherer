import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Neighborhood radius for median calculation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const medianFilter = (input, options: any = defaults) => {
  const { radius, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const maxSamples = (radius * 2 + 1) * (radius * 2 + 1);
  const rArr = new Uint8Array(maxSamples);
  const gArr = new Uint8Array(maxSamples);
  const bArr = new Uint8Array(maxSamples);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let count = 0;

      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          // Circular neighborhood
          if (kx * kx + ky * ky > radius * radius) continue;
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          rArr[count] = buf[ni];
          gArr[count] = buf[ni + 1];
          bArr[count] = buf[ni + 2];
          count++;
        }
      }

      // Sort and pick median (insertion sort for small arrays)
      const sort = (arr: Uint8Array, n: number) => {
        for (let i = 1; i < n; i++) {
          const key = arr[i];
          let j = i - 1;
          while (j >= 0 && arr[j] > key) { arr[j + 1] = arr[j]; j--; }
          arr[j + 1] = key;
        }
      };

      sort(rArr, count);
      sort(gArr, count);
      sort(bArr, count);

      const mid = count >> 1;
      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(rArr[mid], gArr[mid], bArr[mid], buf[di + 3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[di + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Median Filter", func: medianFilter, optionTypes, options: defaults, defaults };
