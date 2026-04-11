import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { clamp, cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";

const DEPTH_MODE = {
  LUMA: "LUMA",
  VERTICAL: "VERTICAL",
  HYBRID: "HYBRID",
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp(0, 1, (value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const optionTypes = {
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "Blend strength of the atmospheric haze" },
  horizon: { type: RANGE, range: [0, 1], step: 0.01, default: 0.42, desc: "Approximate horizon line; higher values push haze lower in the frame" },
  softness: { type: RANGE, range: [0.05, 0.6], step: 0.01, default: 0.18, desc: "How gradually the haze rolls in around the horizon" },
  highlightBloom: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Extra glow on bright regions within the haze" },
  tint: { type: COLOR, default: [168, 206, 255], desc: "Atmospheric tint color" },
  depthMode: {
    type: ENUM,
    options: [
      { name: "Hybrid", value: DEPTH_MODE.HYBRID },
      { name: "Vertical", value: DEPTH_MODE.VERTICAL },
      { name: "Luma", value: DEPTH_MODE.LUMA },
    ],
    default: DEPTH_MODE.HYBRID,
    desc: "How haze depth is estimated from the image",
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  strength: optionTypes.strength.default,
  horizon: optionTypes.horizon.default,
  softness: optionTypes.softness.default,
  highlightBloom: optionTypes.highlightBloom.default,
  tint: optionTypes.tint.default,
  depthMode: optionTypes.depthMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const atmosphericHaze = (input, options: any = defaults) => {
  const { strength, horizon, softness, highlightBloom, tint, depthMode, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y += 1) {
    const yNorm = H <= 1 ? 0 : y / (H - 1);
    const verticalDepth = 1 - smoothstep(horizon - softness, horizon + softness, yNorm);

    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];

      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const lumaDepth = luma;
      const depth = depthMode === DEPTH_MODE.VERTICAL
        ? verticalDepth
        : depthMode === DEPTH_MODE.LUMA
          ? lumaDepth
          : (verticalDepth * 0.65) + (lumaDepth * 0.35);

      const haze = clamp(0, 1, depth * strength);
      const bloom = highlightBloom * haze * smoothstep(0.55, 1, luma);
      const tintMix = clamp(0, 1, haze + bloom * 0.5);

      const liftedR = r + (tint[0] - r) * tintMix;
      const liftedG = g + (tint[1] - g) * tintMix;
      const liftedB = b + (tint[2] - b) * tintMix;

      const whiteMix = bloom * 0.35;
      const finalR = clamp(0, 255, Math.round(liftedR + (255 - liftedR) * whiteMix));
      const finalG = clamp(0, 255, Math.round(liftedG + (255 - liftedG) * whiteMix));
      const finalB = clamp(0, 255, Math.round(liftedB + (255 - liftedB) * whiteMix));

      const color = srgbPaletteGetColor(palette, rgba(finalR, finalG, finalB, a), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Atmospheric Haze",
  func: atmosphericHaze,
  optionTypes,
  options: defaults,
  defaults,
};
