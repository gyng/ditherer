import { ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  logFilterBackend,
  paletteGetColor,
  rgba,
} from "../utils/index";
import { defineFilter, type FilterOptionValues } from "./types";
import { seededUnit, transmitFaxRows, type FaxCoding, type FaxConcealment } from "./signalCodecs";

export const optionTypes = {
  scanMode: {
    type: ENUM,
    options: [
      { name: "Standard — 1728 pels, 3.85 lines/mm", value: "STANDARD" },
      { name: "Fine — 1728 pels, 7.7 lines/mm", value: "FINE" },
      { name: "Superfine — 3456 pels, 15.4 lines/mm", value: "SUPERFINE" },
    ],
    default: "STANDARD",
    desc: "T.4 A4 scan density and vertical line pitch",
  },
  threshold: {
    type: RANGE,
    range: [0, 255],
    step: 1,
    default: 128,
    desc: "Black/white document scanner threshold",
  },
  coding: {
    type: ENUM,
    options: [
      { name: "MH — one dimensional", value: "MH" },
      { name: "MR — mixed 1D/2D", value: "MR" },
      { name: "MMR — two dimensional", value: "MMR" },
    ],
    default: "MR",
    desc: "ITU-T T.4/T.6 coding dependency; MR/MMR errors can damage dependent rows",
  },
  bitErrorRate: {
    type: RANGE,
    range: [0, 0.002],
    step: 0.00001,
    default: 0.00008,
    desc: "Raw channel bit error probability applied to encoded line payloads",
  },
  concealment: {
    type: ENUM,
    options: [
      { name: "Repeat previous line", value: "PREVIOUS" },
      { name: "Print white", value: "WHITE" },
      { name: "Delete / pull next line", value: "DELETE" },
    ],
    default: "PREVIOUS",
    desc: "Damaged scan-line concealment strategy from ITU-T E.453",
  },
  scanNoise: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.12,
    desc: "Scanner threshold noise and occasional mechanical row displacement",
  },
  yellowing: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.3,
    desc: "Aged thermal-paper yellowing intensity",
  },
  randomSeed: {
    type: RANGE,
    range: [0, 9999],
    step: 1,
    default: 42,
    desc: "Deterministic scanner and transmission fault seed",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  scanMode: optionTypes.scanMode.default,
  threshold: optionTypes.threshold.default,
  coding: optionTypes.coding.default,
  bitErrorRate: optionTypes.bitErrorRate.default,
  concealment: optionTypes.concealment.default,
  scanNoise: optionTypes.scanNoise.default,
  yellowing: optionTypes.yellowing.default,
  randomSeed: optionTypes.randomSeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } },
};

type FaxOptions = FilterOptionValues &
  Partial<typeof defaults> & {
    _frameIndex?: number;
    /** Pre-T.4 saved chains used this visual-compression control. */
    compression?: number;
    /** Pre-T.4 saved chains used an arbitrary horizontal sample count. */
    resolution?: number;
  };

const finite = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const resolveFaxBitErrorRate = (options: {
  bitErrorRate?: unknown;
  compression?: unknown;
}): number => {
  const explicitBer =
    options.compression === undefined
      ? finite(options.bitErrorRate, defaults.bitErrorRate)
      : Math.max(0, Math.min(1, finite(options.compression, 0.4))) * 0.0002;
  return Math.max(0, Math.min(0.002, explicitBer));
};

const SCAN_PROFILES = {
  STANDARD: { columns: 1728, horizontalPelsPerMm: 8, verticalLinesPerMm: 3.85, mrK: 2 },
  FINE: { columns: 1728, horizontalPelsPerMm: 8, verticalLinesPerMm: 7.7, mrK: 4 },
  SUPERFINE: { columns: 3456, horizontalPelsPerMm: 16, verticalLinesPerMm: 15.4, mrK: 4 },
} as const;

export const resolveFaxSampling = (
  width: number,
  options: { scanMode?: unknown; resolution?: unknown },
): { scaleX: number; scaleY: number; mrK: number; mode: string } => {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  if (options.resolution !== undefined) {
    const legacyColumns = Math.max(50, Math.min(300, finite(options.resolution, 100)));
    const legacyScale = Math.max(1, Math.round(safeWidth / legacyColumns));
    return { scaleX: legacyScale, scaleY: legacyScale, mrK: 2, mode: "LEGACY" };
  }
  const requestedMode = String(options.scanMode);
  const mode: keyof typeof SCAN_PROFILES =
    requestedMode === "FINE" ? "FINE" : requestedMode === "SUPERFINE" ? "SUPERFINE" : "STANDARD";
  const profile = SCAN_PROFILES[mode];
  const scaleX = Math.max(1, Math.round(safeWidth / profile.columns));
  const scaleY = Math.max(
    1,
    Math.round((scaleX * profile.horizontalPelsPerMm) / profile.verticalLinesPerMm),
  );
  return { scaleX, scaleY, mrK: profile.mrK, mode };
};

const faxMachine = (input: HTMLCanvasElement, options: FaxOptions = defaults) => {
  const width = input.width;
  const height = input.height;
  if (width < 1 || height < 1) return input;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const threshold = Math.max(0, Math.min(255, finite(options.threshold, defaults.threshold)));
  const scanNoise = Math.max(0, Math.min(1, finite(options.scanNoise, defaults.scanNoise)));
  const yellowing = Math.max(0, Math.min(1, finite(options.yellowing, defaults.yellowing)));
  // The legacy property is not part of new defaults, so its presence reliably
  // identifies a saved pre-T.4 state even after runtime defaults are merged.
  const bitErrorRate = resolveFaxBitErrorRate(options);
  const coding = (
    ["MH", "MR", "MMR"].includes(String(options.coding)) ? options.coding : defaults.coding
  ) as FaxCoding;
  const concealment = (
    ["WHITE", "PREVIOUS", "DELETE"].includes(String(options.concealment))
      ? options.concealment
      : defaults.concealment
  ) as FaxConcealment;
  const seed =
    Math.trunc(finite(options.randomSeed, defaults.randomSeed)) +
    Math.trunc(finite(options._frameIndex, 0)) * 7919;
  const palette = options.palette ?? defaults.palette;
  const sampling = resolveFaxSampling(width, options);
  const source = inputCtx.getImageData(0, 0, width, height).data;
  const scannedRows: Uint8Array[] = [];

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    const rowFault = seededUnit(seed, y, 1) < scanNoise * 0.08;
    const shift = rowFault ? Math.round((seededUnit(seed, y, 2) - 0.5) * 10) : 0;
    for (let x = 0; x < width; x++) {
      const sx = Math.max(
        0,
        Math.min(width - 1, Math.floor(x / sampling.scaleX) * sampling.scaleX + shift),
      );
      const sy = Math.min(height - 1, Math.floor(y / sampling.scaleY) * sampling.scaleY);
      const index = getBufferIndex(sx, sy, width);
      const luma = source[index] * 0.2126 + source[index + 1] * 0.7152 + source[index + 2] * 0.0722;
      const scannerNoise = (seededUnit(seed, x, y + 17) - 0.5) * scanNoise * 48;
      row[x] = luma + scannerNoise < threshold ? 1 : 0;
    }
    scannedRows.push(row);
  }

  const channel = transmitFaxRows(
    scannedRows,
    coding,
    bitErrorRate,
    seed ^ 0x54434f44,
    concealment,
    sampling.mrK,
  );
  const out = new Uint8ClampedArray(width * height * 4);
  const paper = [
    Math.round(245 - yellowing * 30),
    Math.round(240 - yellowing * 40),
    Math.round(230 - yellowing * 70),
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = getBufferIndex(x, y, width);
      const black = channel.rows[y]?.[x] === 1;
      const inkVariation = 0.86 + seededUnit(seed, x + 101, y + 211) * 0.14;
      const rgb = black
        ? [
            Math.round(20 * inkVariation),
            Math.round(20 * inkVariation),
            Math.round(25 * inkVariation),
          ]
        : paper;
      const color = paletteGetColor(
        palette,
        rgba(rgb[0], rgb[1], rgb[2], 255),
        palette.options,
        false,
      );
      fillBufferPixel(out, index, color[0], color[1], color[2], 255);
    }
  }
  outputCtx.putImageData(new ImageData(out, width, height), 0, 0);
  logFilterBackend(
    "Fax Machine",
    "JavaScript",
    `${sampling.mode}/${coding} ber=${bitErrorRate} damaged=${channel.damagedRows.length}`,
  );
  return output;
};

export default defineFilter({
  name: "Fax Machine",
  func: faxMachine,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "ITU-T T.4 Group 3 and T.6 Group 4 scan-line channel with dependent-row damage and E.453 concealment",
  temporal: true,
  noGL: "T.4 variable-length line decoding and dependent-row concealment are sequential",
});
