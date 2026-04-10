import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  resolution: { type: RANGE, range: [50, 400], step: 10, default: 200, desc: "Print resolution in pixels wide" },
  fadeGradient: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Thermal fade toward paper edges" },
  dotDensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Print head dot coverage density" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  fadeGradient: optionTypes.fadeGradient.default,
  dotDensity: optionTypes.dotDensity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const thermalPrinter = (input, options: any = defaults) => {
  const { resolution, fadeGradient, dotDensity, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 31 + 42);

  const scale = Math.max(1, Math.round(W / resolution));

  for (let y = 0; y < H; y++) {
    // Paper curl: slight vertical fade at top and bottom
    const edgeDist = Math.min(y, H - y) / H;
    const curlFade = fadeGradient > 0 ? Math.min(1, edgeDist / (fadeGradient * 0.1 + 0.05)) : 1;

    for (let x = 0; x < W; x++) {
      // Reduced resolution sampling
      const sx = Math.floor(x / scale) * scale;
      const sy = Math.floor(y / scale) * scale;
      const si = getBufferIndex(Math.min(W - 1, sx), Math.min(H - 1, sy), W);

      const lum = (0.2126 * buf[si] + 0.7152 * buf[si + 1] + 0.0722 * buf[si + 2]) / 255;
      const darkness = (1 - lum) * dotDensity * curlFade;

      // Thermal dots: random dropout for texture
      const printed = darkness > rng() * 0.8;

      const i = getBufferIndex(x, y, W);
      if (printed) {
        // Dark thermal ink (slightly brownish when faded)
        const fade = 1 - fadeGradient * (1 - curlFade);
        outBuf[i] = Math.round(30 + (1 - fade) * 40);
        outBuf[i + 1] = Math.round(25 + (1 - fade) * 30);
        outBuf[i + 2] = Math.round(35 + (1 - fade) * 20);
      } else {
        // Paper: slightly off-white, warmer at edges
        outBuf[i] = 248; outBuf[i + 1] = 245; outBuf[i + 2] = 240;
      }
      outBuf[i + 3] = 255;
    }
  }

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Thermal Printer", func: thermalPrinter, optionTypes, options: defaults, defaults };
