import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  angle: { type: RANGE, range: [0, 360], step: 15, default: 135, desc: "Light direction angle for the emboss relief effect" },
  strength: { type: RANGE, range: [0, 3], step: 0.1, default: 1, desc: "Emboss depth — higher values exaggerate the relief" },
  blend: { type: RANGE, range: [0, 1], step: 0.05, default: 0, desc: "Blend between embossed result (0) and original image (1)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  angle: optionTypes.angle.default,
  strength: optionTypes.strength.default,
  blend: optionTypes.blend.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const embossFilter = (input, options: any = defaults) => {
  const { angle, strength, blend, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Build directional 3x3 emboss kernel from angle
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad); // y-axis inverted in image coords

  // Kernel weights based on direction projection
  const kernel = new Float32Array(9);
  for (let ky = -1; ky <= 1; ky++) {
    for (let kx = -1; kx <= 1; kx++) {
      const proj = kx * dx + ky * dy;
      kernel[(ky + 1) * 3 + (kx + 1)] = proj * strength;
    }
  }
  // Center pixel: ensure kernel sums to 0 (edge detection property)
  // then add 1 to keep brightness centered
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += kernel[i];
  kernel[4] -= sum;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let er = 0, eg = 0, eb = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          const si = getBufferIndex(nx, ny, W);
          const w = kernel[(ky + 1) * 3 + (kx + 1)];
          er += buf[si] * w;
          eg += buf[si + 1] * w;
          eb += buf[si + 2] * w;
        }
      }

      // Shift to mid-gray (128) to show relief
      er = er + 128;
      eg = eg + 128;
      eb = eb + 128;

      const i = getBufferIndex(x, y, W);

      // Blend with original
      const r = Math.max(0, Math.min(255, Math.round(er * (1 - blend) + buf[i] * blend)));
      const g = Math.max(0, Math.min(255, Math.round(eg * (1 - blend) + buf[i + 1] * blend)));
      const b = Math.max(0, Math.min(255, Math.round(eb * (1 - blend) + buf[i + 2] * blend)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Emboss",
  func: embossFilter,
  optionTypes,
  options: defaults,
  defaults
};
