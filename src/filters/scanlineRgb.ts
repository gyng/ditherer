import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  lineHeight: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "Height of each RGB sub-line" },
  brightness: { type: RANGE, range: [0.5, 2], step: 0.1, default: 1.5, desc: "Brightness boost to compensate for filtering" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lineHeight: optionTypes.lineHeight.default,
  brightness: optionTypes.brightness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const scanlineRgb = (input, options: any = defaults) => {
  const { lineHeight, brightness, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    // Determine which channel this line shows (R=0, G=1, B=2)
    const channelGroup = Math.floor(y / lineHeight) % 3;

    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = 0, g = 0, b = 0;

      // Only show the active channel, boosted by brightness
      if (channelGroup === 0) r = Math.min(255, Math.round(buf[i] * brightness));
      else if (channelGroup === 1) g = Math.min(255, Math.round(buf[i + 1] * brightness));
      else b = Math.min(255, Math.round(buf[i + 2] * brightness));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Scanline RGB", func: scanlineRgb, optionTypes, options: defaults, defaults };
