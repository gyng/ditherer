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
  quality: { type: RANGE, range: [1, 100], step: 1, default: 15, desc: "Simulated JPEG quality — lower = more artifacts" },
  blockSize: { type: RANGE, range: [4, 64], step: 4, default: 8, desc: "DCT block size for compression simulation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  quality: optionTypes.quality.default,
  blockSize: optionTypes.blockSize.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Simulate JPEG block artifacts by quantizing each block's pixels
// to a reduced set of values, mimicking DCT coefficient quantization
const jpegArtifact = (input, options: any = defaults) => {
  const { quality, blockSize, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Quantization step: lower quality = larger step = more artifacts
  const qStep = Math.max(1, Math.round((101 - quality) * 2.5));

  for (let by = 0; by < H; by += blockSize) {
    for (let bx = 0; bx < W; bx += blockSize) {
      const bw = Math.min(blockSize, W - bx);
      const bh = Math.min(blockSize, H - by);

      // Compute block average for DC component
      let avgR = 0, avgG = 0, avgB = 0;
      let count = 0;
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const i = getBufferIndex(bx + dx, by + dy, W);
          avgR += buf[i];
          avgG += buf[i + 1];
          avgB += buf[i + 2];
          count++;
        }
      }
      avgR /= count;
      avgG /= count;
      avgB /= count;

      // Process each pixel: quantize the difference from block average
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const i = getBufferIndex(bx + dx, by + dy, W);

          // Quantize each channel relative to block mean
          const qr = Math.round((buf[i] - avgR) / qStep) * qStep + avgR;
          const qg = Math.round((buf[i + 1] - avgG) / qStep) * qStep + avgG;
          const qb = Math.round((buf[i + 2] - avgB) / qStep) * qStep + avgB;

          const r = Math.max(0, Math.min(255, Math.round(qr)));
          const g = Math.max(0, Math.min(255, Math.round(qg)));
          const b = Math.max(0, Math.min(255, Math.round(qb)));

          const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "JPEG Artifact",
  func: jpegArtifact,
  optionTypes,
  options: defaults,
  defaults
};
