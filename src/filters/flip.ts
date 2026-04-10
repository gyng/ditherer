import { ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const MODE = { HORIZONTAL: "HORIZONTAL", VERTICAL: "VERTICAL", BOTH: "BOTH" };

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Horizontal", value: MODE.HORIZONTAL },
    { name: "Vertical", value: MODE.VERTICAL },
    { name: "Both", value: MODE.BOTH }
  ], default: MODE.HORIZONTAL, desc: "Flip axis — horizontal, vertical, or both" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const flipFilter = (input, options: any = defaults) => {
  const { mode, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = (mode === MODE.HORIZONTAL || mode === MODE.BOTH) ? W - 1 - x : x;
      const sy = (mode === MODE.VERTICAL || mode === MODE.BOTH) ? H - 1 - y : y;
      const si = getBufferIndex(sx, sy, W);
      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(buf[si], buf[si+1], buf[si+2], buf[si+3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[si+3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Flip", func: flipFilter, optionTypes, options: defaults, defaults };
