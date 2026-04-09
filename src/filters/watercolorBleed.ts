import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  bleedRadius: { type: RANGE, range: [1, 20], step: 1, default: 6 },
  edgeSoftness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5 },
  paperTexture: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bleedRadius: optionTypes.bleedRadius.default,
  edgeSoftness: optionTypes.edgeSoftness.default,
  paperTexture: optionTypes.paperTexture.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const watercolorBleed = (input, options: any = defaults) => {
  const { bleedRadius, edgeSoftness, paperTexture, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const rng = mulberry32(42);

  // Directional blur weighted by luminance similarity (edge-preserving bleed)
  const outR = new Float32Array(W * H);
  const outG = new Float32Array(W * H);
  const outB = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ci = getBufferIndex(x, y, W);
      const cLum = 0.2126 * buf[ci] + 0.7152 * buf[ci + 1] + 0.0722 * buf[ci + 2];
      let sr = 0, sg = 0, sb = 0, sw = 0;

      for (let ky = -bleedRadius; ky <= bleedRadius; ky++) {
        for (let kx = -bleedRadius; kx <= bleedRadius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          const ni = getBufferIndex(nx, ny, W);
          const nLum = 0.2126 * buf[ni] + 0.7152 * buf[ni + 1] + 0.0722 * buf[ni + 2];

          // Weight: closer colors bleed more (watercolor pools by similarity)
          const lumDiff = Math.abs(cLum - nLum) / 255;
          const edgeWeight = 1 - lumDiff * (1 / Math.max(0.1, edgeSoftness));
          const w = Math.max(0, edgeWeight);

          sr += buf[ni] * w; sg += buf[ni + 1] * w; sb += buf[ni + 2] * w; sw += w;
        }
      }

      const pi = y * W + x;
      if (sw > 0) { outR[pi] = sr / sw; outG[pi] = sg / sw; outB[pi] = sb / sw; }
      else { outR[pi] = buf[ci]; outG[pi] = buf[ci + 1]; outB[pi] = buf[ci + 2]; }
    }
  }

  // Render with paper texture
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const i = getBufferIndex(x, y, W);

      let r = outR[pi], g = outG[pi], b = outB[pi];

      // Paper texture: slight random brightness variation
      if (paperTexture > 0) {
        const tex = 1 + (rng() - 0.5) * paperTexture * 0.2;
        r *= tex; g *= tex; b *= tex;
        // Warm paper tint
        r = r * (1 - paperTexture * 0.05) + 250 * paperTexture * 0.05;
        g = g * (1 - paperTexture * 0.08) + 245 * paperTexture * 0.08;
        b = b * (1 - paperTexture * 0.12) + 230 * paperTexture * 0.12;
      }

      const color = paletteGetColor(palette, rgba(
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b))), buf[i + 3]
      ), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Watercolor Bleed", func: watercolorBleed, optionTypes, options: defaults, defaults };
