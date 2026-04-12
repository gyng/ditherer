import { RANGE, ENUM } from "constants/controlTypes";
import { cloneCanvas, sampleBilinear, sampleNearest } from "utils";
import { defineFilter } from "filters/types";

const MODE = {
  RECT_TO_POLAR: "RECT_TO_POLAR",
  POLAR_TO_RECT: "POLAR_TO_RECT"
};

const INTERPOLATION = {
  NEAREST: "NEAREST",
  BILINEAR: "BILINEAR"
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Rect -> Polar", value: MODE.RECT_TO_POLAR },
      { name: "Polar -> Rect", value: MODE.POLAR_TO_RECT }
    ],
    default: MODE.RECT_TO_POLAR,
    desc: "Wrap the image around a circle or unwrap a circular image into a strip"
  },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of the transform" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of the transform" },
  angle: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Rotation offset in degrees" },
  interpolation: {
    type: ENUM,
    options: [
      { name: "Nearest", value: INTERPOLATION.NEAREST },
      { name: "Bilinear", value: INTERPOLATION.BILINEAR }
    ],
    default: INTERPOLATION.BILINEAR,
    desc: "Sampling method for remapped pixels"
  }
};

export const defaults = {
  mode: optionTypes.mode.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  angle: optionTypes.angle.default,
  interpolation: optionTypes.interpolation.default
};

const polarTransform = (input, options = defaults) => {
  const { mode, centerX, centerY, angle, interpolation } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const src = inputCtx.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(src.length);
  const cx = W * centerX;
  const cy = H * centerY;
  const maxRadius = Math.max(1, Math.min(W, H) * 0.5);
  const angleOffset = angle * Math.PI / 180;
  const sample = interpolation === INTERPOLATION.NEAREST ? sampleNearest : sampleBilinear;
  const rgba = [0, 0, 0, 255];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx = 0;
      let sy = 0;
      let visible = true;

      if (mode === MODE.RECT_TO_POLAR) {
        const dx = x - cx;
        const dy = y - cy;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius > maxRadius) {
          visible = false;
        } else {
          let theta = Math.atan2(dy, dx) - angleOffset;
          if (theta < 0) theta += Math.PI * 2;
          sx = theta / (Math.PI * 2) * (W - 1);
          sy = radius / maxRadius * (H - 1);
        }
      } else {
        const theta = (x / Math.max(1, W - 1)) * Math.PI * 2 + angleOffset;
        const radius = y / Math.max(1, H - 1) * maxRadius;
        sx = cx + Math.cos(theta) * radius;
        sy = cy + Math.sin(theta) * radius;
      }

      const i = (y * W + x) * 4;
      if (!visible) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 255;
        continue;
      }

      sample(src, W, H, sx, sy, rgba);
      out[i] = rgba[0];
      out[i + 1] = rgba[1];
      out[i + 2] = rgba[2];
      out[i + 3] = rgba[3];
    }
  }

  outputCtx.putImageData(new ImageData(out, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Polar Transform",
  func: polarTransform,
  optionTypes,
  options: defaults,
  defaults
});
