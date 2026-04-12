import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  silverTone: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Intensity of silver/mercury toning" },
  softFocus: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Blur radius for period-accurate softness" },
  vignette: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Edge darkening intensity" },
  metallic: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Metallic plate sheen effect" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  silverTone: optionTypes.silverTone.default,
  softFocus: optionTypes.softFocus.default,
  vignette: optionTypes.vignette.default,
  metallic: optionTypes.metallic.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const daguerreotype = (input, options = defaults) => {
  const { silverTone, softFocus, vignette, metallic, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Soft focus via box blur
  const blurred = new Float32Array(W * H * 3);
  const r = Math.max(1, softFocus);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let ky = -r; ky <= r; ky++)
        for (let kx = -r; kx <= r; kx++) {
          const ni = getBufferIndex(Math.max(0, Math.min(W - 1, x + kx)), Math.max(0, Math.min(H - 1, y + ky)), W);
          sr += buf[ni]; sg += buf[ni + 1]; sb += buf[ni + 2]; cnt++;
        }
      const idx = (y * W + x) * 3;
      blurred[idx] = sr / cnt; blurred[idx + 1] = sg / cnt; blurred[idx + 2] = sb / cnt;
    }

  const cx = W / 2, cy = H / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bi = (y * W + x) * 3;
      const lr = blurred[bi], lg = blurred[bi + 1], lb = blurred[bi + 2];

      // Convert to luminance
      const lum = (0.2126 * lr + 0.7152 * lg + 0.0722 * lb) / 255;

      // Silver-blue tone (daguerreotype color)
      const toneR = lum * (180 + silverTone * 40);
      const toneG = lum * (185 + silverTone * 30);
      const toneB = lum * (200 + silverTone * 55);

      // Metallic sheen: brighten highlights, deepen shadows
      let fr = toneR, fg = toneG, fb = toneB;
      if (metallic > 0) {
        const highlight = Math.pow(lum, 0.5) * metallic * 60;
        fr += highlight; fg += highlight; fb += highlight * 1.1;
      }

      // Oval vignette
      if (vignette > 0) {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const dist = Math.sqrt(dx * dx * 1.5 + dy * dy * 1.5); // Oval
        const vig = Math.max(0, 1 - Math.pow(Math.max(0, dist - 0.3) / 0.7, 2)) ;
        const factor = 1 - (1 - vig) * vignette;
        fr *= factor; fg *= factor; fb *= factor;
      }

      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(
        Math.max(0, Math.min(255, Math.round(fr))),
        Math.max(0, Math.min(255, Math.round(fg))),
        Math.max(0, Math.min(255, Math.round(fb))), 255
      ), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Daguerreotype", func: daguerreotype, optionTypes, options: defaults, defaults });
