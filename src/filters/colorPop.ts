import { RANGE } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

const smoothstep = (edge0: number, edge1: number, x: number) => {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const optionTypes = {
  targetHue: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Hue family to preserve in degrees" },
  hueWidth: { type: RANGE, range: [5, 180], step: 1, default: 25, desc: "Half-width of the protected hue band" },
  desaturateOthers: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "How much to mute colors outside the selected hue band" },
  softness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Soft falloff around the hue band edge" }
};

export const defaults = {
  targetHue: optionTypes.targetHue.default,
  hueWidth: optionTypes.hueWidth.default,
  desaturateOthers: optionTypes.desaturateOthers.default,
  softness: optionTypes.softness.default
};

const colorPop = (input, options: any = defaults) => {
  const { targetHue, hueWidth, desaturateOthers, softness } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const softEdge = hueWidth + softness * 90;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i] / 255;
      const g = buf[i + 1] / 255;
      const b = buf[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let hue = 0;

      if (delta !== 0) {
        if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        else if (max === g) hue = ((b - r) / delta + 2) / 6;
        else hue = ((r - g) / delta + 4) / 6;
      }

      let hueDist = Math.abs(hue * 360 - targetHue);
      if (hueDist > 180) hueDist = 360 - hueDist;

      const protectedMix = 1 - smoothstep(hueWidth, softEdge, hueDist);
      const mute = desaturateOthers * (1 - protectedMix);
      const gray = Math.round(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]);

      outBuf[i] = Math.round(buf[i] * (1 - mute) + gray * mute);
      outBuf[i + 1] = Math.round(buf[i + 1] * (1 - mute) + gray * mute);
      outBuf[i + 2] = Math.round(buf[i + 2] * (1 - mute) + gray * mute);
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Color Pop",
  func: colorPop,
  optionTypes,
  options: defaults,
  defaults
};
