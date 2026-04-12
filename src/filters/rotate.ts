import { RANGE, COLOR, PALETTE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  angle: { type: RANGE, range: [-180, 180], step: 1, default: 15, desc: "Rotation angle in degrees" },
  spinPerFrame: { type: RANGE, range: [-45, 45], step: 0.5, default: 2, desc: "Additional degrees of rotation applied every animation frame" },
  bgColor: { type: COLOR, default: [0, 0, 0], desc: "Fill color for exposed corners" },
  palette: { type: PALETTE, default: nearest },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  angle: optionTypes.angle.default,
  spinPerFrame: optionTypes.spinPerFrame.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
  animSpeed: optionTypes.animSpeed.default,
};

type RotateOptions = FilterOptionValues & {
  angle?: number;
  spinPerFrame?: number;
  bgColor?: number[];
  animSpeed?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
};

const rotateFilter = (input: any, options: RotateOptions = defaults) => {
  const angle = Number(options.angle ?? defaults.angle);
  const spinPerFrame = Number(options.spinPerFrame ?? defaults.spinPerFrame);
  const bgColor = Array.isArray(options.bgColor) ? options.bgColor : defaults.bgColor;
  const palette = options.palette ?? defaults.palette;
  const frameIndex = Number(options._frameIndex ?? 0);
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const animatedAngle = angle + spinPerFrame * frameIndex;
  const rad = (-animatedAngle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const cx = W / 2, cy = H / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = cx + dx * cosA - dy * sinA;
      const sy = cy + dx * sinA + dy * cosA;
      const di = getBufferIndex(x, y, W);

      if (sx < 0 || sx >= W - 1 || sy < 0 || sy >= H - 1) {
        fillBufferPixel(outBuf, di, bgColor[0], bgColor[1], bgColor[2], 255);
        continue;
      }

      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const g = (px: number, py: number) => buf[getBufferIndex(px, py, W) + ch];
        return g(sx0,sy0)*(1-fx)*(1-fy) + g(sx0+1,sy0)*fx*(1-fy) + g(sx0,sy0+1)*(1-fx)*fy + g(sx0+1,sy0+1)*fx*fy;
      };

      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter<RotateOptions>({
  name: "Rotate",
  func: rotateFilter,
  optionTypes,
  options: defaults,
  defaults,
});
