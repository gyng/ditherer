import { RANGE, PALETTE, BOOL } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 50], step: 0.5, default: 8 },
  angle: { type: RANGE, range: [-180, 180], step: 1, default: 0 },
  radial: { type: BOOL, default: true },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  angle: optionTypes.angle.default,
  radial: optionTypes.radial.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const chromaticAberration = (input, options = defaults) => {
  const { strength, angle, radial, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);

      let distFactor = 1;
      if (radial) {
        const distX = x - cx;
        const distY = y - cy;
        distFactor = Math.sqrt(distX * distX + distY * distY) / maxDist;
      }

      const offset = strength * distFactor;
      const rX = Math.max(0, Math.min(W - 1, Math.round(x - dx * offset)));
      const rY = Math.max(0, Math.min(H - 1, Math.round(y - dy * offset)));
      const bX = Math.max(0, Math.min(W - 1, Math.round(x + dx * offset)));
      const bY = Math.max(0, Math.min(H - 1, Math.round(y + dy * offset)));
      const rI = getBufferIndex(rX, rY, W);
      const bI = getBufferIndex(bX, bY, W);

      const col = paletteGetColor(
        palette,
        rgba(buf[rI], buf[i + 1], buf[bI + 2], buf[i + 3]),
        palette.options,
        options._linearize
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Chromatic aberration",
  func: chromaticAberration,
  options: defaults,
  optionTypes,
  defaults
};
