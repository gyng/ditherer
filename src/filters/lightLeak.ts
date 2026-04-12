import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const POS = { TL: "TL", TR: "TR", BL: "BL", BR: "BR" };

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Light leak brightness" },
  position: { type: ENUM, options: [
    { name: "Top-Left", value: POS.TL }, { name: "Top-Right", value: POS.TR },
    { name: "Bottom-Left", value: POS.BL }, { name: "Bottom-Right", value: POS.BR }
  ], default: POS.TR, desc: "Corner where the light leak originates" },
  color: { type: COLOR, default: [255, 120, 50], desc: "Leak color tint" },
  spread: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.4, desc: "How far the leak extends into the image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  position: optionTypes.position.default,
  color: optionTypes.color.default,
  spread: optionTypes.spread.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lightLeak = (input, options = defaults) => {
  const { intensity, position, color: leakColor, spread, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const srcX = position === POS.TR || position === POS.BR ? W : 0;
  const srcY = position === POS.BL || position === POS.BR ? H : 0;
  const maxDist = Math.sqrt(W * W + H * H) * spread;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const dx = x - srcX, dy = y - srcY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Leak falloff: exponential decay from source corner
      const t = Math.max(0, 1 - dist / maxDist);
      const leakIntensity = t * t * intensity;

      // Additive blend with slight screen mode
      const r = Math.min(255, Math.round(buf[i] + leakColor[0] * leakIntensity));
      const g = Math.min(255, Math.round(buf[i + 1] + leakColor[1] * leakIntensity * 0.7));
      const b = Math.min(255, Math.round(buf[i + 2] + leakColor[2] * leakIntensity * 0.4));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Light Leak", func: lightLeak, optionTypes, options: defaults, defaults });
