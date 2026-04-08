import { RANGE, PALETTE, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const DIRECTION_X = "X";
const DIRECTION_Y = "Y";
const DIRECTION_BOTH = "BOTH";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 100], step: 0.5, default: 20 },
  direction: {
    type: ENUM,
    options: [
      { name: "Horizontal", value: DIRECTION_X },
      { name: "Vertical", value: DIRECTION_Y },
      { name: "Both", value: DIRECTION_BOTH }
    ],
    default: DIRECTION_BOTH
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  direction: optionTypes.direction.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const displace = (input, options = defaults) => {
  const { strength, direction, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const lum = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      const disp = (lum - 0.5) * strength;

      const srcX = direction !== DIRECTION_Y
        ? Math.max(0, Math.min(W - 1, Math.round(x + disp)))
        : x;
      const srcY = direction !== DIRECTION_X
        ? Math.max(0, Math.min(H - 1, Math.round(y + disp)))
        : y;

      const srcI = getBufferIndex(srcX, srcY, W);
      const col = paletteGetColor(
        palette,
        rgba(buf[srcI], buf[srcI + 1], buf[srcI + 2], buf[srcI + 3]),
        palette.options,
        options._linearize
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Displace",
  func: displace,
  options: defaults,
  optionTypes,
  defaults
};
