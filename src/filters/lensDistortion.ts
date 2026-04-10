import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";

export const optionTypes = {
  k1: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.3, desc: "Primary distortion (+barrel, -pincushion)" },
  k2: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Secondary radial distortion for fine-tuning edges" },
  zoom: { type: RANGE, range: [0.1, 3], step: 0.01, default: 1, desc: "Zoom factor to compensate for distortion cropping" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  k1: optionTypes.k1.default,
  k2: optionTypes.k2.default,
  zoom: optionTypes.zoom.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Newton's method to invert r_dst = r_src*(1 + k1*r_src^2 + k2*r_src^4)
const invertRadius = (rDst: number, k1: number, k2: number): number => {
  if (rDst === 0) return 0;
  let r = rDst;
  for (let n = 0; n < 8; n += 1) {
    const r2 = r * r;
    const r4 = r2 * r2;
    const f = r * (1 + k1 * r2 + k2 * r4) - rDst;
    const fp = 1 + 3 * k1 * r2 + 5 * k2 * r4;
    if (fp === 0) break;
    r -= f / fp;
  }
  return r;
};

const lensDistortion = (input, options = defaults) => {
  const { k1, k2, zoom, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cx = W / 2;
  const cy = H / 2;
  // Normalize radius so corners = 1
  const rNorm = Math.sqrt(cx * cx + cy * cy);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      // Normalized destination coords [-1, 1]
      const nx = (x - cx) / rNorm;
      const ny = (y - cy) / rNorm;
      const rDst = Math.sqrt(nx * nx + ny * ny);

      // Find source radius
      const rSrc = invertRadius(rDst, k1, k2);
      const scale = rDst > 0 ? (rSrc / rDst) / zoom : 1 / zoom;

      const srcX = Math.round(cx + nx * scale * rNorm);
      const srcY = Math.round(cy + ny * scale * rNorm);

      if (srcX < 0 || srcX >= W || srcY < 0 || srcY >= H) {
        // Out of bounds — leave transparent
        fillBufferPixel(outBuf, i, 0, 0, 0, 0);
        continue;
      }

      const srcI = getBufferIndex(srcX, srcY, W);
      const col = srgbPaletteGetColor(
        palette,
        rgba(buf[srcI], buf[srcI + 1], buf[srcI + 2], buf[srcI + 3]),
        palette.options
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Lens distortion",
  func: lensDistortion,
  options: defaults,
  optionTypes,
  defaults
};
