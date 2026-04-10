import { COLOR, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";

export const optionTypes = {
  inkA: { type: COLOR, default: [28, 24, 24], desc: "Shadow ink color used for the darker end of the print" },
  inkB: { type: COLOR, default: [194, 58, 58], desc: "Highlight/accent ink color used for the lighter end of the print" },
  mixCurve: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1, desc: "Bias toward the dark or accent plate across the tonal ramp" },
  paperColor: { type: COLOR, default: [244, 237, 224], desc: "Paper stock color visible under the duplex inks" }
};

export const defaults = {
  inkA: optionTypes.inkA.default,
  inkB: optionTypes.inkB.default,
  mixCurve: optionTypes.mixCurve.default,
  paperColor: optionTypes.paperColor.default
};

const duplexPrint = (input, options: any = defaults) => {
  const { inkA, inkB, mixCurve, paperColor } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < buf.length; i += 4) {
    const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    const darkPlate = Math.pow(1 - lum, mixCurve);
    const accentPlate = Math.pow(lum, 1 / Math.max(0.001, mixCurve));

    outBuf[i] = Math.max(0, Math.min(255, Math.round(
      paperColor[0] * (1 - darkPlate * 0.9 - accentPlate * 0.65) +
      inkA[0] * darkPlate * 0.9 +
      inkB[0] * accentPlate * 0.65
    )));
    outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(
      paperColor[1] * (1 - darkPlate * 0.9 - accentPlate * 0.65) +
      inkA[1] * darkPlate * 0.9 +
      inkB[1] * accentPlate * 0.65
    )));
    outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(
      paperColor[2] * (1 - darkPlate * 0.9 - accentPlate * 0.65) +
      inkA[2] * darkPlate * 0.9 +
      inkB[2] * accentPlate * 0.65
    )));
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Duplex Print",
  func: duplexPrint,
  optionTypes,
  options: defaults,
  defaults
};
