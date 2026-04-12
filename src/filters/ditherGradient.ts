import { RANGE, COLOR, PALETTE, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const STYLE = {
  PRINT: "PRINT",
  DREAMY: "DREAMY",
};

export const optionTypes = {
  color1: { type: COLOR, default: [28, 18, 12], desc: "Start color of the gradient" },
  color2: { type: COLOR, default: [246, 214, 132], desc: "End color of the gradient" },
  angle: { type: RANGE, range: [0, 360], step: 5, default: 35, desc: "Gradient direction in degrees" },
  style: {
    type: ENUM,
    options: [
      { name: "Poster / Print", value: STYLE.PRINT },
      { name: "Dreamy / Color Map", value: STYLE.DREAMY },
    ],
    default: STYLE.PRINT,
    desc: "Treat the source as either graphic print structure or a dreamy color-mapped guide",
  },
  amount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "How strongly the ordered dither pattern perturbs the gradient before quantization" },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "How much the source luminance remaps the generated gradient" },
  detailInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "How much source edges intensify local dither contrast" },
  sourceColorMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "How much source color tints the gradient result", visibleWhen: (options: any) => options.style === STYLE.DREAMY },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  angle: optionTypes.angle.default,
  style: optionTypes.style.default,
  amount: optionTypes.amount.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  detailInfluence: optionTypes.detailInfluence.default,
  sourceColorMix: optionTypes.sourceColorMix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const ditherGradient = (input: any, options: any = defaults) => {
  const {
    color1,
    color2,
    angle,
    style = defaults.style,
    amount,
    sourceInfluence,
    detailInfluence,
    sourceColorMix = defaults.sourceColorMix,
    palette,
  } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const src = inputCtx.getImageData(0, 0, W, H).data;
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
      const baseT = (proj - minProj) / range;
      const i = getBufferIndex(x, y, W);
      const srcLuma = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;
      const leftI = getBufferIndex(Math.max(0, x - 1), y, W);
      const rightI = getBufferIndex(Math.min(W - 1, x + 1), y, W);
      const upI = getBufferIndex(x, Math.max(0, y - 1), W);
      const downI = getBufferIndex(x, Math.min(H - 1, y + 1), W);
      const neighborAvg = (
        0.2126 * src[leftI] + 0.7152 * src[leftI + 1] + 0.0722 * src[leftI + 2] +
        0.2126 * src[rightI] + 0.7152 * src[rightI + 1] + 0.0722 * src[rightI + 2] +
        0.2126 * src[upI] + 0.7152 * src[upI + 1] + 0.0722 * src[upI + 2] +
        0.2126 * src[downI] + 0.7152 * src[downI + 1] + 0.0722 * src[downI + 2]
      ) / (255 * 4);
      const edge = Math.min(1, Math.abs(srcLuma - neighborAvg) * 3);
      const warpedT = style === STYLE.PRINT
        ? Math.max(0, Math.min(1, baseT * (1 - sourceInfluence) + srcLuma * sourceInfluence))
        : Math.max(0, Math.min(1, baseT * (1 - sourceInfluence * 0.65) + srcLuma * sourceInfluence * 0.65 + edge * 0.12));

      let r = color1[0] + (color2[0] - color1[0]) * warpedT;
      let g = color1[1] + (color2[1] - color1[1]) * warpedT;
      let b = color1[2] + (color2[2] - color1[2]) * warpedT;

      if (style === STYLE.DREAMY) {
        const tintMix = sourceColorMix * (0.55 + edge * 0.45);
        const haze = 0.12 + sourceInfluence * 0.1;
        r = r * (1 - tintMix) + src[i] * tintMix + 255 * haze * 0.35;
        g = g * (1 - tintMix) + src[i + 1] * tintMix + 255 * haze * 0.22;
        b = b * (1 - tintMix) + src[i + 2] * tintMix + 255 * haze * 0.5;
      } else {
        const contrast = 1.15 + edge * detailInfluence * 1.4;
        r = (r - 127.5) * contrast + 127.5;
        g = (g - 127.5) * contrast + 127.5;
        b = (b - 127.5) * contrast + 127.5;
      }

      const threshold = (BAYER_4X4[y % 4][x % 4] + 0.5) / 16 - 0.5;
      const ditherBias = style === STYLE.PRINT
        ? threshold * 255 * amount * (1 + edge * detailInfluence * 2)
        : threshold * 255 * amount * (0.55 + edge * detailInfluence);

      const color = paletteGetColor(
        palette,
        rgba(
          Math.max(0, Math.min(255, Math.round(r + ditherBias))),
          Math.max(0, Math.min(255, Math.round(g + ditherBias))),
          Math.max(0, Math.min(255, Math.round(b + ditherBias))),
          255
        ),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Dither Gradient", func: ditherGradient, optionTypes, options: defaults, defaults, description: "Map a gradient through the source image's luminance and edge structure, then ordered-dither the result" });
