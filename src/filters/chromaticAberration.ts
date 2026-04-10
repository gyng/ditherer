import { RANGE, PALETTE, BOOL, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";

const MODE_AXIAL       = "AXIAL";
const MODE_INDEPENDENT = "INDEPENDENT";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Axial (angle + radial)", value: MODE_AXIAL },
      { name: "Per-channel", value: MODE_INDEPENDENT }
    ],
    default: MODE_AXIAL,
    desc: "Aberration model — axial or manual per-channel offsets"
  },
  // Axial mode
  strength: { type: RANGE, range: [0, 50], step: 0.5, default: 8, desc: "Overall aberration intensity" },
  angle:    { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Direction of color fringing in degrees" },
  radial:   { type: BOOL, default: true, desc: "Increase fringing toward image edges" },
  // Per-channel mode: independent X/Y offsets for R, G, B
  rOffsetX: { type: RANGE, range: [-50, 50], step: 0.5, default: -8, desc: "Red channel horizontal offset" },
  rOffsetY: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Red channel vertical offset" },
  gOffsetX: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Green channel horizontal offset" },
  gOffsetY: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Green channel vertical offset" },
  bOffsetX: { type: RANGE, range: [-50, 50], step: 0.5, default: 8, desc: "Blue channel horizontal offset" },
  bOffsetY: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Blue channel vertical offset" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  strength: optionTypes.strength.default,
  angle: optionTypes.angle.default,
  radial: optionTypes.radial.default,
  rOffsetX: optionTypes.rOffsetX.default,
  rOffsetY: optionTypes.rOffsetY.default,
  gOffsetX: optionTypes.gOffsetX.default,
  gOffsetY: optionTypes.gOffsetY.default,
  bOffsetX: optionTypes.bOffsetX.default,
  bOffsetY: optionTypes.bOffsetY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clampCoord = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(v)));

const chromaticAberration = (input, options = defaults) => {
  const { mode, strength, angle, radial, rOffsetX, rOffsetY, gOffsetX, gOffsetY, bOffsetX, bOffsetY, palette } = options;
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

      let rX: number, rY: number, gX: number, gY: number, bX: number, bY: number;

      if (mode === MODE_INDEPENDENT) {
        rX = clampCoord(x + rOffsetX, W); rY = clampCoord(y + rOffsetY, H);
        gX = clampCoord(x + gOffsetX, W); gY = clampCoord(y + gOffsetY, H);
        bX = clampCoord(x + bOffsetX, W); bY = clampCoord(y + bOffsetY, H);
      } else {
        let distFactor = 1;
        if (radial) {
          const distX = x - cx;
          const distY = y - cy;
          distFactor = Math.sqrt(distX * distX + distY * distY) / maxDist;
        }
        const offset = strength * distFactor;
        rX = clampCoord(x - dx * offset, W); rY = clampCoord(y - dy * offset, H);
        gX = x;                               gY = y;
        bX = clampCoord(x + dx * offset, W); bY = clampCoord(y + dy * offset, H);
      }

      const rI = getBufferIndex(rX, rY, W);
      const gI = getBufferIndex(gX, gY, W);
      const bI = getBufferIndex(bX, bY, W);

      const col = srgbPaletteGetColor(
        palette,
        rgba(buf[rI], buf[gI + 1], buf[bI + 2], buf[i + 3]),
        palette.options
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
