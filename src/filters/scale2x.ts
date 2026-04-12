import { ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const ALGORITHM = { SCALE2X: "SCALE2X", EAGLE: "EAGLE", NEAREST: "NEAREST" };

export const optionTypes = {
  algorithm: { type: ENUM, options: [
    { name: "Scale2x", value: ALGORITHM.SCALE2X },
    { name: "Eagle", value: ALGORITHM.EAGLE },
    { name: "Nearest", value: ALGORITHM.NEAREST }
  ], default: ALGORITHM.SCALE2X, desc: "Pixel-art upscaling algorithm" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  algorithm: optionTypes.algorithm.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorsEqual = (buf: Uint8ClampedArray, i: number, j: number) =>
  buf[i] === buf[j] && buf[i+1] === buf[j+1] && buf[i+2] === buf[j+2];

const copyPixel = (outBuf: Uint8ClampedArray, di: number, srcBuf: Uint8ClampedArray, si: number) => {
  outBuf[di] = srcBuf[si]; outBuf[di+1] = srcBuf[si+1]; outBuf[di+2] = srcBuf[si+2]; outBuf[di+3] = srcBuf[si+3];
};

const scale2x = (input: any, options = defaults) => {
  const { algorithm, palette } = options;
  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Output is 2x size
  const oW = W * 2, oH = H * 2;
  const output = cloneCanvas(input, false);
  output.width = oW;
  output.height = oH;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const outBuf = new Uint8ClampedArray(oW * oH * 4);

  const getIdx = (x: number, y: number) => getBufferIndex(Math.max(0, Math.min(W-1, x)), Math.max(0, Math.min(H-1, y)), W);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const P = getIdx(x, y);
      const ox = x * 2, oy = y * 2;
      const d0 = (oy * oW + ox) * 4;
      const d1 = (oy * oW + ox + 1) * 4;
      const d2 = ((oy + 1) * oW + ox) * 4;
      const d3 = ((oy + 1) * oW + ox + 1) * 4;

      if (algorithm === ALGORITHM.NEAREST) {
        copyPixel(outBuf, d0, buf, P);
        copyPixel(outBuf, d1, buf, P);
        copyPixel(outBuf, d2, buf, P);
        copyPixel(outBuf, d3, buf, P);
      } else if (algorithm === ALGORITHM.SCALE2X) {
        const A = getIdx(x, y-1), B = getIdx(x-1, y), C = getIdx(x+1, y), D = getIdx(x, y+1);
        copyPixel(outBuf, d0, buf, colorsEqual(buf, A, B) && !colorsEqual(buf, A, C) && !colorsEqual(buf, B, D) ? A : P);
        copyPixel(outBuf, d1, buf, colorsEqual(buf, A, C) && !colorsEqual(buf, A, B) && !colorsEqual(buf, C, D) ? A : P);
        copyPixel(outBuf, d2, buf, colorsEqual(buf, B, D) && !colorsEqual(buf, A, B) && !colorsEqual(buf, C, D) ? B : P);
        copyPixel(outBuf, d3, buf, colorsEqual(buf, C, D) && !colorsEqual(buf, A, C) && !colorsEqual(buf, B, D) ? C : P);
      } else {
        // Eagle
        const TL = getIdx(x-1, y-1), T = getIdx(x, y-1), TR = getIdx(x+1, y-1);
        const L = getIdx(x-1, y), R = getIdx(x+1, y);
        const BL = getIdx(x-1, y+1), Bo = getIdx(x, y+1), BR = getIdx(x+1, y+1);
        copyPixel(outBuf, d0, buf, colorsEqual(buf, T, L) && colorsEqual(buf, T, TL) ? T : P);
        copyPixel(outBuf, d1, buf, colorsEqual(buf, T, R) && colorsEqual(buf, T, TR) ? T : P);
        copyPixel(outBuf, d2, buf, colorsEqual(buf, Bo, L) && colorsEqual(buf, Bo, BL) ? Bo : P);
        copyPixel(outBuf, d3, buf, colorsEqual(buf, Bo, R) && colorsEqual(buf, Bo, BR) ? Bo : P);
      }
    }
  }

  // Apply palette
  for (let i = 0; i < outBuf.length; i += 4) {
    const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i+1], outBuf[i+2], outBuf[i+3]), palette.options, false);
    outBuf[i] = color[0]; outBuf[i+1] = color[1]; outBuf[i+2] = color[2];
  }

  outputCtx.putImageData(new ImageData(outBuf, oW, oH), 0, 0);
  return output;
};

export default defineFilter({ name: "Pixel Art Upscale", func: scale2x, optionTypes, options: defaults, defaults });
