import { ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, paletteGetColor, rgba } from "utils";

const MATRIX = {
  REC601: "REC601",
  REC709: "REC709",
  REC2020: "REC2020",
};

const RANGE_MODE = {
  FULL: "FULL",
  LIMITED: "LIMITED",
};

const CHROMA = {
  CENTER: "CENTER",
  LEFT: "LEFT",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const decodeYcbcr = (y: number, cb: number, cr: number, matrix: string) => {
  const ccb = cb - 128;
  const ccr = cr - 128;

  if (matrix === MATRIX.REC709) {
    return [
      y + 1.5748 * ccr,
      y - 0.187324 * ccb - 0.468124 * ccr,
      y + 1.8556 * ccb,
    ];
  }

  if (matrix === MATRIX.REC2020) {
    return [
      y + 1.4746 * ccr,
      y - 0.164553 * ccb - 0.571353 * ccr,
      y + 1.8814 * ccb,
    ];
  }

  return [
    y + 1.402 * ccr,
    y - 0.344136 * ccb - 0.714136 * ccr,
    y + 1.772 * ccb,
  ];
};

export const optionTypes = {
  gammaAssumption: { type: RANGE, range: [0.8, 2.6], step: 0.01, default: 1.35, desc: "Assumed transfer curve gamma during decode" },
  matrixAssumption: {
    type: ENUM,
    default: MATRIX.REC709,
    options: [
      { name: "Rec.601", value: MATRIX.REC601 },
      { name: "Rec.709", value: MATRIX.REC709 },
      { name: "Rec.2020", value: MATRIX.REC2020 },
    ],
    desc: "Color matrix assumed by the decoder"
  },
  rangeAssumption: {
    type: ENUM,
    default: RANGE_MODE.LIMITED,
    options: [
      { name: "Full range", value: RANGE_MODE.FULL },
      { name: "Limited range", value: RANGE_MODE.LIMITED },
    ],
    desc: "Range interpretation used before RGB reconstruction"
  },
  chromaPlacement: {
    type: ENUM,
    default: CHROMA.LEFT,
    options: [
      { name: "Centered", value: CHROMA.CENTER },
      { name: "Left-shifted", value: CHROMA.LEFT },
    ],
    desc: "Assumed chroma sample location"
  },
  recoveryMix: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Blend back toward original RGB after mismatch decode" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  gammaAssumption: optionTypes.gammaAssumption.default,
  matrixAssumption: optionTypes.matrixAssumption.default,
  rangeAssumption: optionTypes.rangeAssumption.default,
  chromaPlacement: optionTypes.chromaPlacement.default,
  recoveryMix: optionTypes.recoveryMix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const metadataMismatchDecode = (input, options: any = defaults) => {
  const { gammaAssumption, matrixAssumption, rangeAssumption, chromaPlacement, recoveryMix, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const w = input.width;
  const h = input.height;
  const src = inputCtx.getImageData(0, 0, w, h).data;
  const outBuf = new Uint8ClampedArray(src.length);

  const yPlane = new Float32Array(w * h);
  const cbPlane = new Float32Array(w * h);
  const crPlane = new Float32Array(w * h);

  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    yPlane[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    cbPlane[p] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    crPlane[p] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = getBufferIndex(x, y, w);

      let yy = yPlane[p];
      let cb = cbPlane[p];
      let cr = crPlane[p];

      if (chromaPlacement === CHROMA.LEFT && x > 0) {
        const left = p - 1;
        cb = cbPlane[left];
        cr = crPlane[left];
      }

      if (rangeAssumption === RANGE_MODE.LIMITED) {
        yy = (yy - 16) * (255 / 219);
        cb = 128 + (cb - 128) * (255 / 224);
        cr = 128 + (cr - 128) * (255 / 224);
      }

      let [r, g, b] = decodeYcbcr(yy, cb, cr, matrixAssumption);

      r = clamp(r, 0, 255);
      g = clamp(g, 0, 255);
      b = clamp(b, 0, 255);

      const gamma = Math.max(0.05, gammaAssumption);
      r = Math.pow(r / 255, 1 / gamma) * 255;
      g = Math.pow(g / 255, 1 / gamma) * 255;
      b = Math.pow(b / 255, 1 / gamma) * 255;

      r = r * (1 - recoveryMix) + src[i] * recoveryMix;
      g = g * (1 - recoveryMix) + src[i + 1] * recoveryMix;
      b = b * (1 - recoveryMix) + src[i + 2] * recoveryMix;

      const color = paletteGetColor(palette, rgba(r, g, b, src[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], src[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, w, h), 0, 0);
  return output;
};

export default {
  name: "Metadata Mismatch Decode",
  func: metadataMismatchDecode,
  optionTypes,
  options: defaults,
  defaults,
  description: "Apply wrong gamma, matrix, range, and chroma assumptions to mimic authentic decode metadata failures"
};
