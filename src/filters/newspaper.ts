import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Halftone dot size" },
  yellowing: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Aged newsprint yellowing" },
  foldCrease: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Visible fold crease intensity" },
  inkSmear: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Ink bleeding/smearing amount" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  yellowing: optionTypes.yellowing.default,
  foldCrease: optionTypes.foldCrease.default,
  inkSmear: optionTypes.inkSmear.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const newspaper = (input, options: any = defaults) => {
  const { dotSize, yellowing, foldCrease, inkSmear, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 31 + 42);

  // Paper base: yellowed newsprint
  const paperR = Math.round(240 - yellowing * 20);
  const paperG = Math.round(235 - yellowing * 30);
  const paperB = Math.round(220 - yellowing * 60);

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paperR; outBuf[i + 1] = paperG; outBuf[i + 2] = paperB; outBuf[i + 3] = 255;
  }

  // Halftone dots
  for (let cy = 0; cy < H; cy += dotSize) {
    for (let cx = 0; cx < W; cx += dotSize) {
      let totalLum = 0, count = 0;
      for (let dy = 0; dy < dotSize && cy + dy < H; dy++)
        for (let dx = 0; dx < dotSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          totalLum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          count++;
        }
      const darkness = 1 - totalLum / count / 255;
      const dotR = (dotSize / 2) * Math.sqrt(darkness);
      if (dotR < 0.3) continue;

      // Ink smear: random offset
      const smearX = inkSmear > 0 ? (rng() - 0.5) * inkSmear * 3 : 0;
      const smearY = inkSmear > 0 ? (rng() - 0.5) * inkSmear * 3 : 0;
      const centerX = cx + dotSize / 2 + smearX;
      const centerY = cy + dotSize / 2 + smearY;

      for (let dy = -dotSize; dy <= dotSize; dy++)
        for (let dx = -dotSize; dx <= dotSize; dx++) {
          const px = Math.round(centerX + dx), py = Math.round(centerY + dy);
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > dotR) continue;
          const i = getBufferIndex(px, py, W);
          const ink = Math.min(1, (dotR - dist) / 1.5 + 0.3);
          outBuf[i] = Math.round(outBuf[i] * (1 - ink) + 20 * ink);
          outBuf[i + 1] = Math.round(outBuf[i + 1] * (1 - ink) + 20 * ink);
          outBuf[i + 2] = Math.round(outBuf[i + 2] * (1 - ink) + 20 * ink);
        }
    }
  }

  // Fold creases: horizontal and vertical lines at center
  if (foldCrease > 0) {
    const creaseDarken = foldCrease * 40;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const distH = Math.abs(y - H / 2);
        const distV = Math.abs(x - W / 2);
        const crease = Math.max(0, 1 - Math.min(distH, distV) / 8) * creaseDarken;
        if (crease > 0) {
          const i = getBufferIndex(x, y, W);
          outBuf[i] = Math.max(0, outBuf[i] - Math.round(crease));
          outBuf[i + 1] = Math.max(0, outBuf[i + 1] - Math.round(crease));
          outBuf[i + 2] = Math.max(0, outBuf[i + 2] - Math.round(crease));
        }
      }
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

export default { name: "Newspaper", func: newspaper, optionTypes, options: defaults, defaults };
