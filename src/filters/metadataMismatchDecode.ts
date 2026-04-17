import { ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderMetadataMismatchDecodeGL } from "./metadataMismatchDecodeGL";

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

const metadataMismatchDecode = (input: any, options: typeof defaults = defaults) => {
  const { gammaAssumption, matrixAssumption, rangeAssumption, chromaPlacement, recoveryMix, palette } = options;
  const W = input.width, H = input.height;
  const matrixInt = matrixAssumption === MATRIX.REC709 ? 1 : matrixAssumption === MATRIX.REC2020 ? 2 : 0;
  const rangeInt = rangeAssumption === RANGE_MODE.LIMITED ? 1 : 0;
  const chromaInt = chromaPlacement === CHROMA.LEFT ? 1 : 0;
  const rendered = renderMetadataMismatchDecodeGL(
    input, W, H,
    matrixInt, rangeInt, chromaInt,
    gammaAssumption, recoveryMix,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Metadata Mismatch Decode", "WebGL2", `matrix=${matrixAssumption} range=${rangeAssumption}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Metadata Mismatch Decode",
  func: metadataMismatchDecode,
  optionTypes,
  options: defaults,
  defaults,
  description: "Apply wrong gamma, matrix, range, and chroma assumptions to mimic authentic decode metadata failures",
  requiresGL: true,
});
