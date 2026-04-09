import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  dotSize: { type: RANGE, range: [2, 20], step: 1, default: 6 },
  angleC: { type: RANGE, range: [0, 180], step: 5, default: 15 },
  angleM: { type: RANGE, range: [0, 180], step: 5, default: 75 },
  angleY: { type: RANGE, range: [0, 180], step: 5, default: 0 },
  angleK: { type: RANGE, range: [0, 180], step: 5, default: 45 },
  paperColor: { type: COLOR, default: [255, 250, 245] },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  angleC: optionTypes.angleC.default,
  angleM: optionTypes.angleM.default,
  angleY: optionTypes.angleY.default,
  angleK: optionTypes.angleK.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const cmykHalftone = (input, options: any = defaults) => {
  const { dotSize, angleC, angleM, angleY, angleK, paperColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Convert to CMYK
  const cmyk = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i] / 255, g = buf[i + 1] / 255, b = buf[i + 2] / 255;
      const k = 1 - Math.max(r, g, b);
      const ci = (k < 1) ? (1 - r - k) / (1 - k) : 0;
      const mi = (k < 1) ? (1 - g - k) / (1 - k) : 0;
      const yi = (k < 1) ? (1 - b - k) / (1 - k) : 0;
      const idx = (y * W + x) * 4;
      cmyk[idx] = ci; cmyk[idx + 1] = mi; cmyk[idx + 2] = yi; cmyk[idx + 3] = k;
    }
  }

  // Generate halftone screen for one channel
  const renderScreen = (channel: number, angleDeg: number, outR: Float32Array, outG: Float32Array, outB: Float32Array) => {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Rotate coordinates
        const rx = x * cosA + y * sinA;
        const ry = -x * sinA + y * cosA;

        // Distance to nearest dot center
        const cx = (Math.round(rx / dotSize) + 0.5) * dotSize;
        const cy = (Math.round(ry / dotSize) + 0.5) * dotSize;
        const dist = Math.sqrt((rx - cx) * (rx - cx) + (ry - cy) * (ry - cy));

        // CMYK value at this pixel
        const idx = (y * W + x) * 4;
        const value = cmyk[idx + channel];

        // Dot radius proportional to ink density
        const maxR = dotSize * 0.7;
        const dotR = maxR * Math.sqrt(value);

        if (dist < dotR) {
          // Subtractive: CMYK removes from paper
          const intensity = Math.min(1, (dotR - dist) / 1.5 + 0.5);
          const pi = y * W + x;
          if (channel === 0) { outR[pi] *= (1 - intensity); } // Cyan removes red
          else if (channel === 1) { outG[pi] *= (1 - intensity); } // Magenta removes green
          else if (channel === 2) { outB[pi] *= (1 - intensity); } // Yellow removes blue
          else { // Key (black) removes all
            outR[pi] *= (1 - intensity);
            outG[pi] *= (1 - intensity);
            outB[pi] *= (1 - intensity);
          }
        }
      }
    }
  };

  // Start with paper color
  const outR = new Float32Array(W * H);
  const outG = new Float32Array(W * H);
  const outB = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    outR[i] = paperColor[0] / 255;
    outG[i] = paperColor[1] / 255;
    outB[i] = paperColor[2] / 255;
  }

  // Render each CMYK screen
  renderScreen(0, angleC, outR, outG, outB);
  renderScreen(1, angleM, outR, outG, outB);
  renderScreen(2, angleY, outR, outG, outB);
  renderScreen(3, angleK, outR, outG, outB);

  // Write output
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const di = getBufferIndex(x, y, W);
      const r = Math.round(outR[pi] * 255);
      const g = Math.round(outG[pi] * 255);
      const b = Math.round(outB[pi] * 255);
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "CMYK Halftone",
  func: cmykHalftone,
  optionTypes,
  options: defaults,
  defaults
};
