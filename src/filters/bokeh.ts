import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const SHAPE = { CIRCLE: "CIRCLE", HEXAGON: "HEXAGON" };

export const optionTypes = {
  radius: { type: RANGE, range: [2, 20], step: 1, default: 8, desc: "Size of blur kernel and bokeh highlight shapes" },
  threshold: { type: RANGE, range: [100, 255], step: 1, default: 200, desc: "Luminance cutoff — brighter pixels become bokeh highlights" },
  intensity: { type: RANGE, range: [0, 2], step: 0.1, default: 1, desc: "Brightness multiplier for the bokeh highlight shapes" },
  shape: { type: ENUM, options: [
    { name: "Circle", value: SHAPE.CIRCLE },
    { name: "Hexagon", value: SHAPE.HEXAGON }
  ], default: SHAPE.CIRCLE, desc: "Shape of the bokeh highlight" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  intensity: optionTypes.intensity.default,
  shape: optionTypes.shape.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const bokeh = (input, options = defaults) => {
  const { radius, threshold, intensity, shape, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Gaussian blur base
  const blurR = new Float32Array(W * H);
  const blurG = new Float32Array(W * H);
  const blurB = new Float32Array(W * H);
  const sigma = radius / 2;
  const kr = Math.ceil(sigma * 2);

  // Horizontal pass
  const tempR = new Float32Array(W * H), tempG = new Float32Array(W * H), tempB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let k = -kr; k <= kr; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const ni = getBufferIndex(nx, y, W);
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        sr += buf[ni] * w; sg += buf[ni + 1] * w; sb += buf[ni + 2] * w; sw += w;
      }
      const pi = y * W + x;
      tempR[pi] = sr / sw; tempG[pi] = sg / sw; tempB[pi] = sb / sw;
    }
  // Vertical pass
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let k = -kr; k <= kr; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const pi = ny * W + x;
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        sr += tempR[pi] * w; sg += tempG[pi] * w; sb += tempB[pi] * w; sw += w;
      }
      const pi = y * W + x;
      blurR[pi] = sr / sw; blurG[pi] = sg / sw; blurB[pi] = sb / sw;
    }

  // Start with blurred image
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const di = getBufferIndex(x, y, W);
      outBuf[di] = Math.round(blurR[pi]); outBuf[di + 1] = Math.round(blurG[pi]); outBuf[di + 2] = Math.round(blurB[pi]); outBuf[di + 3] = buf[di + 3];
    }

  // Add bokeh highlights: find bright pixels and stamp shapes
  for (let y = 0; y < H; y += Math.max(1, Math.floor(radius / 2))) {
    for (let x = 0; x < W; x += Math.max(1, Math.floor(radius / 2))) {
      const ci = getBufferIndex(x, y, W);
      const lum = 0.2126 * buf[ci] + 0.7152 * buf[ci + 1] + 0.0722 * buf[ci + 2];
      if (lum < threshold) continue;

      const bokehIntensity = ((lum - threshold) / (255 - threshold)) * intensity;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = x + dx, py = y + dy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;

          const inShape = shape === SHAPE.CIRCLE
            ? dx * dx + dy * dy <= radius * radius
            : Math.abs(dy) <= radius * 0.866 && Math.abs(dx) + Math.abs(dy) * 0.577 <= radius;
          if (!inShape) continue;

          // Edge falloff
          const dist = Math.sqrt(dx * dx + dy * dy);
          const edgeFade = Math.max(0, 1 - dist / radius);
          const ringFade = dist > radius * 0.7 ? 1.5 : edgeFade; // Bright ring at edge

          const di = getBufferIndex(px, py, W);
          const add = bokehIntensity * ringFade * 80;
          outBuf[di] = Math.min(255, outBuf[di] + Math.round(add * buf[ci] / 255));
          outBuf[di + 1] = Math.min(255, outBuf[di + 1] + Math.round(add * buf[ci + 1] / 255));
          outBuf[di + 2] = Math.min(255, outBuf[di + 2] + Math.round(add * buf[ci + 2] / 255));
        }
      }
    }
  }

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Bokeh", func: bokeh, optionTypes, options: defaults, defaults });
