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
  lineSpacing: { type: RANGE, range: [2, 12], step: 1, default: 4 },
  angle: { type: RANGE, range: [0, 180], step: 1, default: 45 },
  amplitude: { type: RANGE, range: [1, 10], step: 1, default: 3 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lineSpacing: optionTypes.lineSpacing.default,
  angle: optionTypes.angle.default,
  amplitude: optionTypes.amplitude.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const zigzag = (
  input,
  options = defaults
) => {
  const {
    lineSpacing,
    angle,
    amplitude,
    palette
  } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Compute luminance
      const luma = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
      const darkness = 1 - luma / 255;

      // Project position along perpendicular of angle
      const perpDist = x * sinA - y * cosA;
      // Project along the angle direction for sawtooth wave
      const parDist = x * cosA + y * sinA;

      // Sawtooth wave along the parallel direction (zigzag)
      const period = lineSpacing * 2;
      const sawPhase = ((parDist % period) + period) % period;
      const sawValue = sawPhase < period / 2
        ? (sawPhase / (period / 2)) * amplitude
        : ((period - sawPhase) / (period / 2)) * amplitude;

      // Distance from nearest zigzag line center
      const zigzagCenter = Math.round(perpDist / lineSpacing) * lineSpacing;
      const dist = Math.abs(perpDist - zigzagCenter + sawValue - amplitude / 2);

      // Line thickness based on darkness
      const thickness = darkness * lineSpacing * 0.8;

      const isInk = dist < thickness / 2;

      let r: number, g: number, b: number;
      if (isInk) {
        r = 0; g = 0; b = 0;
      } else {
        r = 255; g = 255; b = 255;
      }

      r = clamp(r);
      g = clamp(g);
      b = clamp(b);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default {
  name: "Zigzag",
  func: zigzag,
  options: defaults,
  optionTypes,
  defaults
};
