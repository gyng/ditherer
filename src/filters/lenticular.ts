import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  stripWidth: { type: RANGE, range: [2, 20], step: 1, default: 6, desc: "Width of each lenticular strip" },
  angle: { type: RANGE, range: [0, 360], step: 5, default: 0, desc: "Strip rotation angle in degrees" },
  sheenIntensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Holographic sheen strength" },
  rainbowSpread: { type: RANGE, range: [0, 3], step: 0.1, default: 1, desc: "Rainbow color spread across strips" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  stripWidth: optionTypes.stripWidth.default,
  angle: optionTypes.angle.default,
  sheenIntensity: optionTypes.sheenIntensity.default,
  rainbowSpread: optionTypes.rainbowSpread.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  const hh = ((h % 360) + 360) % 360;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const lenticular = (input, options: any = defaults) => {
  const { stripWidth, angle, sheenIntensity, rainbowSpread, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Project onto strip direction
      const proj = x * cosA + y * sinA;
      const stripPos = ((proj / stripWidth) % 1 + 1) % 1;

      // Rainbow hue based on position
      const hue = (proj / stripWidth * rainbowSpread * 60) % 360;
      const [sheenR, sheenG, sheenB] = hslToRgb(hue, 0.8, 0.6);

      // Lenticular lens effect: brightness varies across each strip
      const lensFactor = 0.7 + 0.3 * Math.cos(stripPos * Math.PI * 2);

      // Blend original with rainbow sheen
      const r = Math.round(buf[i] * lensFactor * (1 - sheenIntensity) + sheenR * sheenIntensity * lensFactor);
      const g = Math.round(buf[i + 1] * lensFactor * (1 - sheenIntensity) + sheenG * sheenIntensity * lensFactor);
      const b = Math.round(buf[i + 2] * lensFactor * (1 - sheenIntensity) + sheenB * sheenIntensity * lensFactor);

      const color = paletteGetColor(palette, rgba(
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b)), buf[i + 3]
      ), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Lenticular", func: lenticular, optionTypes, options: defaults, defaults };
