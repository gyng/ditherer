import { ENUM, PALETTE, RANGE } from "constants/controlTypes";
import * as palettes from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const MODE = {
  DARKEN: "DARKEN",
  RGB_SUBLINES: "RGB_SUBLINES",
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Darken lines", value: MODE.DARKEN },
      { name: "RGB sub-lines", value: MODE.RGB_SUBLINES },
    ],
    default: MODE.DARKEN,
    desc: "Classic scanline darkening or phosphor-style RGB sub-line separation",
  },
  intensity: {
    type: RANGE,
    range: [0, 4],
    step: 0.01,
    default: 0.33,
    desc: "How dark each scanline becomes in darken-lines mode",
    visibleWhen: (options) => options.mode === MODE.DARKEN,
  },
  gap: {
    type: RANGE,
    range: [1, 255],
    step: 1,
    default: 3,
    desc: "Spacing between scanlines in darken-lines mode",
    visibleWhen: (options) => options.mode === MODE.DARKEN,
  },
  height: {
    type: RANGE,
    range: [1, 255],
    step: 1,
    default: 1,
    desc: "Thickness of each darkened line in darken-lines mode",
    visibleWhen: (options) => options.mode === MODE.DARKEN,
  },
  lineHeight: {
    type: RANGE,
    range: [1, 6],
    step: 1,
    default: 2,
    desc: "Height of each RGB sub-line in phosphor mode",
    visibleWhen: (options) => options.mode === MODE.RGB_SUBLINES,
  },
  brightness: {
    type: RANGE,
    range: [0.5, 2],
    step: 0.1,
    default: 1.5,
    desc: "Brightness boost to compensate for RGB sub-line filtering",
    visibleWhen: (options) => options.mode === MODE.RGB_SUBLINES,
  },
  palette: { type: PALETTE, default: palettes.nearest },
};

export const defaults = {
  mode: optionTypes.mode.default,
  intensity: optionTypes.intensity.default,
  gap: optionTypes.gap.default,
  height: optionTypes.height.default,
  lineHeight: optionTypes.lineHeight.default,
  brightness: optionTypes.brightness.default,
  palette: optionTypes.palette.default,
};

const scanline = (input, options: any = defaults) => {
  const { mode, intensity, gap, height, lineHeight, brightness, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y += 1) {
    const channelGroup = Math.floor(y / lineHeight) % 3;
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i];
      let g = buf[i + 1];
      let b = buf[i + 2];

      if (mode === MODE.DARKEN) {
        const scale = y % gap < height ? intensity : 1;
        r *= scale;
        g *= scale;
        b *= scale;
      } else {
        r = channelGroup === 0 ? Math.min(255, Math.round(r * brightness)) : 0;
        g = channelGroup === 1 ? Math.min(255, Math.round(g * brightness)) : 0;
        b = channelGroup === 2 ? Math.min(255, Math.round(b * brightness)) : 0;
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Scanline",
  func: scanline,
  optionTypes,
  options: defaults,
  defaults,
  description: "CRT-style scanlines with either classic darkened rows or RGB phosphor sub-line separation",
};
