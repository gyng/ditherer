import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  rr: { type: RANGE, range: [-1, 2], step: 0.05, default: 1, desc: "Red contribution to output red" },
  rg: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Green contribution to output red" },
  rb: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Blue contribution to output red" },
  gr: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Red contribution to output green" },
  gg: { type: RANGE, range: [-1, 2], step: 0.05, default: 1, desc: "Green contribution to output green" },
  gb: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Blue contribution to output green" },
  br: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Red contribution to output blue" },
  bg: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Green contribution to output blue" },
  bb: { type: RANGE, range: [-1, 2], step: 0.05, default: 1, desc: "Blue contribution to output blue" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  rr: 1, rg: 0, rb: 0,
  gr: 0, gg: 1, gb: 0,
  br: 0, bg: 0, bb: 1,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const channelMixer = (input, options = defaults) => {
  const { rr, rg, rb, gr, gg, gb, br, bg, bb, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const sr = buf[i], sg = buf[i + 1], sb = buf[i + 2];

      const r = Math.max(0, Math.min(255, Math.round(sr * rr + sg * rg + sb * rb)));
      const g = Math.max(0, Math.min(255, Math.round(sr * gr + sg * gg + sb * gb)));
      const b = Math.max(0, Math.min(255, Math.round(sr * br + sg * bg + sb * bb)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Channel Mixer", func: channelMixer, optionTypes, options: defaults, defaults });
