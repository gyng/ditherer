import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { THEMES } from "palettes/user";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  plates: { type: RANGE, range: [2, 4], step: 1, default: 3, desc: "Number of spot-color plates to layer" },
  offset: { type: RANGE, range: [0, 24], step: 1, default: 6, desc: "Maximum misregistration offset between plates in pixels" },
  angleJitter: { type: RANGE, range: [0, 45], step: 1, default: 12, desc: "Randomize each plate's shift direction by this many degrees" },
  paperColor: { type: COLOR, default: [244, 237, 224], desc: "Base paper stock color under the inks" },
  inkStrength: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.75, desc: "Opacity of each spot-color layer" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  plates: optionTypes.plates.default,
  offset: optionTypes.offset.default,
  angleJitter: optionTypes.angleJitter.default,
  paperColor: optionTypes.paperColor.default,
  inkStrength: optionTypes.inkStrength.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const SPOT_COLORS = [
  THEMES.RISOGRAPH[1].slice(0, 3),
  THEMES.RISOGRAPH[2].slice(0, 3),
  THEMES.RISOGRAPH[4].slice(0, 3),
  THEMES.RISOGRAPH[3].slice(0, 3)
];

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const sampleChannel = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number) => {
  const sx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return data[getBufferIndex(sx, sy, width) + channel];
};

const screenPrint = (input, options = defaults) => {
  const { plates, offset, angleJitter, paperColor, inkStrength, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const activeColors = SPOT_COLORS.slice(0, plates);

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paperColor[0];
    outBuf[i + 1] = paperColor[1];
    outBuf[i + 2] = paperColor[2];
    outBuf[i + 3] = 255;
  }

  for (let p = 0; p < activeColors.length; p += 1) {
    const plateColor = activeColors[p];
    const baseAngle = (Math.PI * 2 * p) / activeColors.length;
    const jitterAngle = (angleJitter * Math.PI) / 180;
    const theta = baseAngle + (p % 2 === 0 ? 1 : -1) * jitterAngle;
    const offX = Math.cos(theta) * offset * (0.5 + p * 0.25);
    const offY = Math.sin(theta) * offset * (0.5 + p * 0.25);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const srcR = sampleChannel(buf, width, height, x - offX, y - offY, 0);
        const srcG = sampleChannel(buf, width, height, x - offX, y - offY, 1);
        const srcB = sampleChannel(buf, width, height, x - offX, y - offY, 2);

        const plateLuma = p === 0
          ? 1 - srcR / 255
          : p === 1
            ? 1 - srcG / 255
            : p === 2
              ? 1 - srcB / 255
              : 1 - (srcR * 0.2126 + srcG * 0.7152 + srcB * 0.0722) / 255;

        const ink = Math.max(0, Math.min(1, plateLuma * inkStrength));
        if (ink <= 0.01) continue;

        const i = getBufferIndex(x, y, width);
        outBuf[i] = clamp255(outBuf[i] * (1 - ink) + plateColor[0] * ink);
        outBuf[i + 1] = clamp255(outBuf[i + 1] * (1 - ink) + plateColor[1] * ink);
        outBuf[i + 2] = clamp255(outBuf[i + 2] * (1 - ink) + plateColor[2] * ink);
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const color = paletteGetColor(
        palette,
        rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Screen Print",
  func: screenPrint,
  options: defaults,
  optionTypes,
  defaults,
  description: "Layer a few flat spot-color plates with visible misregistration for a silkscreen poster look"
});
