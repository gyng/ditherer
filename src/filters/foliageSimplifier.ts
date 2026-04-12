import { PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { clamp, cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const boxBlur = (buf: Uint8ClampedArray, width: number, height: number, radius: number) => {
  if (radius <= 0) return new Uint8ClampedArray(buf);
  const temp = new Float32Array(buf.length);
  const out = new Uint8ClampedArray(buf.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const nx = Math.max(0, Math.min(width - 1, x + k));
        const i = getBufferIndex(nx, y, width);
        sr += buf[i];
        sg += buf[i + 1];
        sb += buf[i + 2];
        sa += buf[i + 3];
      }
      const ti = getBufferIndex(x, y, width);
      temp[ti] = sr / span;
      temp[ti + 1] = sg / span;
      temp[ti + 2] = sb / span;
      temp[ti + 3] = sa / span;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const ny = Math.max(0, Math.min(height - 1, y + k));
        const i = getBufferIndex(x, ny, width);
        sr += temp[i];
        sg += temp[i + 1];
        sb += temp[i + 2];
        sa += temp[i + 3];
      }
      const oi = getBufferIndex(x, y, width);
      out[oi] = Math.round(sr / span);
      out[oi + 1] = Math.round(sg / span);
      out[oi + 2] = Math.round(sb / span);
      out[oi + 3] = Math.round(sa / span);
    }
  }

  return out;
};

export const optionTypes = {
  radius: { type: RANGE, range: [1, 12], step: 1, default: 4, desc: "Neighborhood size used to merge noisy foliage detail" },
  regionMerge: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "How strongly foliage regions collapse into grouped masses" },
  edgePreserve: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Preserve silhouettes and hard edges while simplifying interiors" },
  brushiness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Quantize simplified regions slightly for a brush-like painted look" },
  shadowRetention: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Keep darker foliage pockets from washing out too aggressively" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  radius: optionTypes.radius.default,
  regionMerge: optionTypes.regionMerge.default,
  edgePreserve: optionTypes.edgePreserve.default,
  brushiness: optionTypes.brushiness.default,
  shadowRetention: optionTypes.shadowRetention.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const foliageSimplifier = (input: any, options = defaults) => {
  const { radius, regionMerge, edgePreserve, brushiness, shadowRetention, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const blurred = boxBlur(buf, W, H, radius);
  const outBuf = new Uint8ClampedArray(buf.length);
  const step = Math.max(8, Math.round(64 - brushiness * 40));

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];
      const br = blurred[i];
      const bg = blurred[i + 1];
      const bb = blurred[i + 2];

      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
      const greenDominance = clamp(0, 1, (g - Math.max(r * 0.82, b * 0.9)) / 90);
      const warmLeafDominance = clamp(0, 1, (Math.min(r, g) - b) / 110);
      const foliageMask = clamp(0, 1, saturation * Math.max(greenDominance, warmLeafDominance * 0.65) * 1.35);

      const edge = (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)) / (255 * 3);
      const preserve = 1 - edge * edgePreserve;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const shadowHold = lerp(1 - shadowRetention * 0.65, 1, Math.pow(luma, 0.8));
      const blend = clamp(0, 1, foliageMask * regionMerge * preserve * shadowHold);

      let targetR = br;
      let targetG = bg;
      let targetB = bb;
      if (brushiness > 0) {
        targetR = Math.round(targetR / step) * step;
        targetG = Math.round(targetG / step) * step;
        targetB = Math.round(targetB / step) * step;
      }

      const finalR = clamp(0, 255, Math.round(lerp(r, targetR, blend)));
      const finalG = clamp(0, 255, Math.round(lerp(g, targetG, blend)));
      const finalB = clamp(0, 255, Math.round(lerp(b, targetB, blend)));
      const color = srgbPaletteGetColor(palette, rgba(finalR, finalG, finalB, a), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Foliage Simplifier",
  func: foliageSimplifier,
  optionTypes,
  options: defaults,
  defaults,
});
