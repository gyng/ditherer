import { RANGE, COLOR } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const hashNoise = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
};

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 136, desc: "Brightness cutoff between paper and ink" },
  inkColor: { type: COLOR, default: [24, 16, 16], desc: "Color of the stamped ink" },
  paperColor: { type: COLOR, default: [244, 233, 210], desc: "Paper color behind the stamp" },
  roughness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Edge breakup and uneven inking amount" }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  roughness: optionTypes.roughness.default
};

const stamp = (input, options: any = defaults) => {
  const { threshold, inkColor, paperColor, roughness } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      const jitter = (hashNoise(x, y) - 0.5) * roughness * 80;
      const edgeBias = (hashNoise(x * 0.5 + 19, y * 0.5 + 7) - 0.5) * roughness * 40;
      const inked = lum + jitter < threshold + edgeBias;
      const noiseFade = inked ? 1 - hashNoise(x * 1.7 + 3, y * 1.7 + 11) * roughness * 0.35 : 1;
      const src = inked ? inkColor : paperColor;

      out[i] = Math.round(src[0] * noiseFade + paperColor[0] * (1 - noiseFade));
      out[i + 1] = Math.round(src[1] * noiseFade + paperColor[1] * (1 - noiseFade));
      out[i + 2] = Math.round(src[2] * noiseFade + paperColor[2] * (1 - noiseFade));
      out[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(out, W, H), 0, 0);
  return output;
};

export default {
  name: "Stamp",
  func: stamp,
  optionTypes,
  options: defaults,
  defaults
};
