import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  resolution: { type: RANGE, range: [50, 300], step: 10, default: 100, desc: "Effective scan DPI" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white threshold for fax output" },
  scanNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Random scan-line noise amount" },
  yellowing: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Aged paper yellowing intensity" },
  compression: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Simulated compression artifact level" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  threshold: optionTypes.threshold.default,
  scanNoise: optionTypes.scanNoise.default,
  yellowing: optionTypes.yellowing.default,
  compression: optionTypes.compression.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const faxMachine = (input, options: any = defaults) => {
  const { resolution, threshold, scanNoise, yellowing, compression, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 42);

  // Downscale factor
  const scale = Math.max(1, Math.round(W / resolution));

  // Thermal paper colors
  const paperR = Math.round(245 - yellowing * 30);
  const paperG = Math.round(240 - yellowing * 40);
  const paperB = Math.round(230 - yellowing * 70);

  for (let y = 0; y < H; y++) {
    // Scan line noise: occasional shifted/duplicated lines
    const scanShift = scanNoise > 0 && rng() < scanNoise * 0.1 ? Math.round((rng() - 0.5) * 10) : 0;

    for (let x = 0; x < W; x++) {
      // Sample at reduced resolution
      const sx = Math.floor(x / scale) * scale;
      const sy = Math.floor(y / scale) * scale;
      const srcX = Math.max(0, Math.min(W - 1, sx + scanShift));
      const si = getBufferIndex(srcX, Math.min(H - 1, sy), W);

      const lum = 0.2126 * buf[si] + 0.7152 * buf[si + 1] + 0.0722 * buf[si + 2];

      // Add noise before threshold
      const noise = scanNoise > 0 ? (rng() - 0.5) * scanNoise * 80 : 0;
      const isBlack = (lum + noise) < threshold;

      // Compression artifacts: random pixel drops
      const dropped = compression > 0 && rng() < compression * 0.05;

      const i = getBufferIndex(x, y, W);
      if (isBlack && !dropped) {
        const ink = 0.85 + rng() * 0.15; // Slightly uneven ink
        outBuf[i] = Math.round(20 * ink);
        outBuf[i + 1] = Math.round(20 * ink);
        outBuf[i + 2] = Math.round(25 * ink);
      } else {
        outBuf[i] = paperR;
        outBuf[i + 1] = paperG;
        outBuf[i + 2] = paperB;
      }
      outBuf[i + 3] = 255;
    }
  }

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Fax Machine", func: faxMachine, optionTypes, options: defaults, defaults };
