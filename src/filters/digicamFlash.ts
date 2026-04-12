import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  paletteGetColor,
  rgba,
} from "utils";

const clamp = (min: number, max: number, v: number) => Math.max(min, Math.min(max, v));

export const optionTypes = {
  flashPower: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Flash output strength" },
  falloff: { type: RANGE, range: [0.8, 3], step: 0.05, default: 1.55, desc: "Distance falloff of flash illumination" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal hotspot center" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.44, desc: "Vertical hotspot center" },
  ambient: { type: RANGE, range: [0.4, 1], step: 0.01, default: 0.76, desc: "How much ambient scene light remains outside flash hotspot" },
  edgeBurn: { type: RANGE, range: [0, 1], step: 0.01, default: 0.35, desc: "Darken outer frame to mimic short-range flash falloff" },
  specular: { type: RANGE, range: [0, 1], step: 0.01, default: 0.6, desc: "Extra reflective highlight pop on bright surfaces" },
  whiteClip: { type: RANGE, range: [200, 255], step: 1, default: 242, desc: "Hard clipping point for blown flash highlights" },
  warmth: { type: RANGE, range: [-0.3, 0.3], step: 0.01, default: 0.02, desc: "Flash white-balance tint: warm (+) to cool (-)" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  flashPower: optionTypes.flashPower.default,
  falloff: optionTypes.falloff.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  ambient: optionTypes.ambient.default,
  edgeBurn: optionTypes.edgeBurn.default,
  specular: optionTypes.specular.default,
  whiteClip: optionTypes.whiteClip.default,
  warmth: optionTypes.warmth.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const digicamFlash = (input, options = defaults) => {
  const {
    flashPower,
    falloff,
    centerX,
    centerY,
    ambient,
    edgeBurn,
    specular,
    whiteClip,
    warmth,
    palette,
  } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cx = W * clamp(0, 1, Number(centerX));
  const cy = H * clamp(0, 1, Number(centerY));
  const maxR = Math.max(W, H) * 0.9;
  const pwr = clamp(0, 3, Number(flashPower));
  const distFalloff = clamp(0.5, 4, Number(falloff));
  const amb = clamp(0.2, 1.2, Number(ambient));
  const edge = clamp(0, 1, Number(edgeBurn));
  const spec = clamp(0, 1, Number(specular));
  const clip = clamp(180, 255, Number(whiteClip));
  const warm = clamp(-0.5, 0.5, Number(warmth));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
      const radial = clamp(0, 1, 1 - dist);
      const illum = pwr * Math.pow(radial, distFalloff);
      const edgeMask = 1 - edge * Math.pow(clamp(0, 1, dist), 1.6);
      const exposure = (amb + illum * 1.35) * edgeMask;

      let r = buf[i] * exposure;
      let g = buf[i + 1] * exposure;
      let b = buf[i + 2] * exposure;

      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const specBoost = Math.pow(clamp(0, 1, (luma - 118) / 137), 2) * illum * spec * 185;
      r += specBoost;
      g += specBoost;
      b += specBoost * 0.95;

      // Flash WB shift: slight warmth by default.
      r *= 1 + warm * 0.25;
      b *= 1 - warm * 0.35;

      if (r > clip) r = 255;
      if (g > clip) g = 255;
      if (b > clip) b = 255;

      const color = paletteGetColor(
        palette,
        rgba(clamp(0, 255, r), clamp(0, 255, g), clamp(0, 255, b), buf[i + 3]),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Digicam Flash",
  func: digicamFlash,
  optionTypes,
  options: defaults,
  defaults,
  description: "On-camera point-and-shoot flash look with center hotspot, rapid falloff, reflective clipping, and edge burn",
});
