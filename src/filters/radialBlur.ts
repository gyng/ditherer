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
  strength: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Blur intensity — increases with distance from center" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal position of the blur center (0=left, 1=right)" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical position of the blur center (0=top, 1=bottom)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const radialBlurFilter = (input, options: any = defaults) => {
  const { strength, centerX, centerY, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cx = W * centerX;
  const cy = H * centerY;
  const maxDist = Math.sqrt(W * W + H * H) / 2;
  const samples = Math.max(3, strength);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Blur amount scales with distance from center
      const blurDist = (dist / maxDist) * strength;

      if (blurDist < 0.5) {
        // Near center: no blur
        const i = getBufferIndex(x, y, W);
        const color = paletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
        continue;
      }

      // Sample along the line from center through this pixel
      let sr = 0, sg = 0, sb = 0, sa = 0;
      let count = 0;

      for (let t = 0; t < samples; t++) {
        const frac = (t / (samples - 1) - 0.5) * 2; // -1 to 1
        const scale = 1 + frac * (blurDist / maxDist);
        const sx = Math.round(cx + dx * scale);
        const sy = Math.round(cy + dy * scale);

        const csx = Math.max(0, Math.min(W - 1, sx));
        const csy = Math.max(0, Math.min(H - 1, sy));
        const si = getBufferIndex(csx, csy, W);
        sr += buf[si]; sg += buf[si + 1]; sb += buf[si + 2]; sa += buf[si + 3];
        count++;
      }

      const i = getBufferIndex(x, y, W);
      const r = Math.round(sr / count);
      const g = Math.round(sg / count);
      const b = Math.round(sb / count);
      const a = Math.round(sa / count);

      const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Radial Blur",
  func: radialBlurFilter,
  optionTypes,
  options: defaults,
  defaults
};
