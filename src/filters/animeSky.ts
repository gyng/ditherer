import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { clamp, cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { animeSkyGLAvailable, renderAnimeSkyGL } from "./animeSkyGL";

const SKY_MODE = {
  GRADIENT: "GRADIENT",
  CLOUDS: "CLOUDS",
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp(0, 1, (value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const pseudoCloud = (xNorm: number, yNorm: number, cloudSoftness: number) => {
  const bandA = Math.sin(xNorm * 8.4 + yNorm * 6.2);
  const bandB = Math.sin(xNorm * 17.1 - yNorm * 11.6);
  const bandC = Math.sin((xNorm + yNorm * 0.75) * 29.3);
  const value = (bandA * 0.45 + bandB * 0.35 + bandC * 0.2 + 1) * 0.5;
  return smoothstep(0.55 - cloudSoftness * 0.25, 0.82 + cloudSoftness * 0.15, value);
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Gradient", value: SKY_MODE.GRADIENT },
      { name: "Gradient + Clouds", value: SKY_MODE.CLOUDS },
    ],
    default: SKY_MODE.CLOUDS,
    desc: "How the sky area is restyled",
  },
  skyStart: { type: RANGE, range: [0.15, 0.85], step: 0.01, default: 0.48, desc: "Bottom edge of the sky region as a fraction of image height" },
  gradientTop: { type: COLOR, default: [87, 150, 255], desc: "Top-of-sky color" },
  gradientBottom: { type: COLOR, default: [223, 240, 255], desc: "Near-horizon sky color" },
  cloudAmount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "Intensity of the painted cloud layer" },
  cloudSoftness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "Softness and spread of cloud shapes" },
  blend: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "How strongly the synthetic sky replaces the detected sky" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  mode: optionTypes.mode.default,
  skyStart: optionTypes.skyStart.default,
  gradientTop: optionTypes.gradientTop.default,
  gradientBottom: optionTypes.gradientBottom.default,
  cloudAmount: optionTypes.cloudAmount.default,
  cloudSoftness: optionTypes.cloudSoftness.default,
  blend: optionTypes.blend.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type AnimeSkyOptions = typeof defaults & { _webglAcceleration?: boolean };

const animeSky = (input: any, options: AnimeSkyOptions = defaults) => {
  const { mode, skyStart, gradientTop, gradientBottom, cloudAmount, cloudSoftness, blend, palette } = options;
  const W = input.width;
  const H = input.height;

  if (options._webglAcceleration !== false && animeSkyGLAvailable()) {
    const rendered = renderAnimeSkyGL(
      input, W, H,
      mode === SKY_MODE.CLOUDS, skyStart,
      [gradientTop[0], gradientTop[1], gradientTop[2]],
      [gradientBottom[0], gradientBottom[1], gradientBottom[2]],
      cloudAmount, cloudSoftness, blend,
    );
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Anime Sky", "WebGL2", `mode=${mode}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y += 1) {
    const yNorm = H <= 1 ? 0 : y / (H - 1);
    const regionMask = 1 - smoothstep(Math.max(0.02, skyStart - 0.12), skyStart + 0.03, yNorm);
    const skyT = clamp(0, 1, yNorm / Math.max(0.001, skyStart));

    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];

      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
      const brightness = maxChannel / 255;
      const blueBias = clamp(0, 1, (b - Math.max(r, g) * 0.8) / 80);
      const candidateMask = clamp(0, 1, blueBias * 0.65 + brightness * 0.25 + (1 - saturation) * 0.1);
      const skyMask = regionMask * candidateMask * blend;

      const gradR = lerp(gradientTop[0], gradientBottom[0], Math.pow(skyT, 0.9));
      const gradG = lerp(gradientTop[1], gradientBottom[1], Math.pow(skyT, 0.9));
      const gradB = lerp(gradientTop[2], gradientBottom[2], Math.pow(skyT, 0.9));

      let targetR = gradR;
      let targetG = gradG;
      let targetB = gradB;

      if (mode === SKY_MODE.CLOUDS && cloudAmount > 0) {
        const xNorm = W <= 1 ? 0 : x / (W - 1);
        const cloudMask = pseudoCloud(xNorm, yNorm, cloudSoftness) * cloudAmount * regionMask;
        targetR = lerp(targetR, 255, cloudMask * 0.9);
        targetG = lerp(targetG, 252, cloudMask * 0.92);
        targetB = lerp(targetB, 248, cloudMask * 0.95);
      }

      const finalR = clamp(0, 255, Math.round(lerp(r, targetR, skyMask)));
      const finalG = clamp(0, 255, Math.round(lerp(g, targetG, skyMask)));
      const finalB = clamp(0, 255, Math.round(lerp(b, targetB, skyMask)));
      const color = srgbPaletteGetColor(palette, rgba(finalR, finalG, finalB, a), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anime Sky",
  func: animeSky,
  optionTypes,
  options: defaults,
  defaults,
});
