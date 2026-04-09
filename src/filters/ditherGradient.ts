import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  color1: { type: COLOR, default: [0, 0, 0] },
  color2: { type: COLOR, default: [255, 255, 255] },
  angle: { type: RANGE, range: [0, 360], step: 5, default: 0 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  angle: optionTypes.angle.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const ditherGradient = (input, options: any = defaults) => {
  const { color1, color2, angle, palette } = options;
  const output = cloneCanvas(input, false);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const W = input.width, H = input.height;
  const outBuf = new Uint8ClampedArray(W * H * 4);

  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  // Find max projection for normalization
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  let minProj = Infinity, maxProj = -Infinity;
  for (const [cx, cy] of corners) {
    const proj = cx * cosA + cy * sinA;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const range = maxProj - minProj || 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const proj = x * cosA + y * sinA;
      const t = (proj - minProj) / range;

      const r = Math.round(color1[0] + (color2[0] - color1[0]) * t);
      const g = Math.round(color1[1] + (color2[1] - color1[1]) * t);
      const b = Math.round(color1[2] + (color2[2] - color1[2]) * t);

      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Dither Gradient", func: ditherGradient, optionTypes, options: defaults, defaults };
