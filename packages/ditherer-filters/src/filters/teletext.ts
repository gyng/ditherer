import { BOOL, ENUM, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderTeletextGL } from "./teletextGL";

export const optionTypes = {
  columns: { type: RANGE, range: [20, 80], step: 1, default: 40, desc: "Character grid width" },
  standardPage: { type: BOOL, default: true, desc: "Use ETSI System B's 24-row geometry while the column count remains 40" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance threshold per block cell" },
  blockGap: { type: RANGE, range: [0, 3], step: 1, default: 1, desc: "Pixel gap between character blocks" },
  bitErrorRate: { type: RANGE, range: [0, 0.05], step: 0.0001, default: 0.002, desc: "Transmission bit error probability before Hamming/parity decoding" },
  burstErrors: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Correlate data errors into horizontal packet bursts" },
  concealment: {
    type: ENUM,
    options: [
      { name: "Blank bad data", value: "BLANK" },
      { name: "Repeat prior row", value: "REPEAT" },
      { name: "Show corrupt mosaics", value: "CORRUPT" },
    ],
    default: "BLANK",
    desc: "Decoder response to uncorrectable packet addresses and parity failures",
  },
  randomSeed: { type: RANGE, range: [0, 9999], step: 1, default: 706, desc: "Deterministic System B packet-channel seed" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" }
};

export const defaults = {
  columns: optionTypes.columns.default,
  standardPage: optionTypes.standardPage.default,
  threshold: optionTypes.threshold.default,
  blockGap: optionTypes.blockGap.default,
  bitErrorRate: optionTypes.bitErrorRate.default,
  burstErrors: optionTypes.burstErrors.default,
  concealment: optionTypes.concealment.default,
  randomSeed: optionTypes.randomSeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 8 } }
};

type TeletextOptions = FilterOptionValues & Partial<typeof defaults>;

const finiteClamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const numeric = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(numeric) ? numeric : fallback));
};

export interface TeletextGeometry {
  columns: number;
  rows: number;
  cellW: number;
  cellH: number;
  blockW: number;
  blockH: number;
  standardPage: boolean;
}

export const resolveTeletextGeometry = (
  width: unknown,
  height: unknown,
  options: { columns?: unknown; standardPage?: unknown },
): TeletextGeometry => {
  const safeWidth = Math.max(1, Math.floor(finiteClamp(width, 1, 1, Number.MAX_SAFE_INTEGER)));
  const safeHeight = Math.max(1, Math.floor(finiteClamp(height, 1, 1, Number.MAX_SAFE_INTEGER)));
  const requestedColumns = Math.round(finiteClamp(options.columns, defaults.columns, 20, 80));
  // `standardPage` did not exist in older saved states. Preserve their custom
  // column grids after default merging; 40 columns still selects the new
  // standards-accurate 24-row geometry.
  const standardPage = options.standardPage !== false && requestedColumns === 40;
  const columns = standardPage ? 40 : requestedColumns;
  const cellW = Math.max(1, Math.floor(safeWidth / columns));
  const cellH = standardPage
    ? Math.max(1, Math.ceil(safeHeight / 24))
    : Math.max(1, Math.round(cellW * (10 / 12)));
  const rows = standardPage ? 24 : Math.ceil(safeHeight / cellH);
  return {
    columns,
    rows,
    cellW,
    cellH,
    // Keep the six mosaic subcells equal even when the raster cell does not
    // divide cleanly by 2x3. The shader works in pixel-center coordinates and
    // accepts fractional boundaries; flooring here made the final row/column
    // absorb the remainder and over-render its separator gap.
    blockW: Math.max(0.5, cellW / 2),
    blockH: Math.max(1 / 3, cellH / 3),
    standardPage,
  };
};

const teletext = (
  input: any,
  options: TeletextOptions = defaults
) => {
  const W = input.width;
  const H = input.height;
  if (W < 1 || H < 1) return input;

  const threshold = finiteClamp(options.threshold, defaults.threshold, 0, 255);
  const blockGap = Math.round(finiteClamp(options.blockGap, defaults.blockGap, 0, 3));
  const palette = options.palette ?? defaults.palette;
  const { columns, rows, cellW, cellH, blockW, blockH } = resolveTeletextGeometry(W, H, options);

  const rendered = renderTeletextGL(input, W, H, columns, threshold, blockGap,
      cellW, cellH, rows, blockW, blockH,
      finiteClamp(options.bitErrorRate, defaults.bitErrorRate, 0, 0.05),
      finiteClamp(options.burstErrors, defaults.burstErrors, 0, 1),
      options.concealment === "REPEAT" ? 1 : options.concealment === "CORRUPT" ? 2 : 0,
      finiteClamp(options.randomSeed, defaults.randomSeed, 0, 9999),
    );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Teletext", "WebGL2", `System B ${columns}x${rows} ber=${finiteClamp(options.bitErrorRate, defaults.bitErrorRate, 0, 0.05)}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Teletext",
  func: teletext,
  options: defaults,
  optionTypes,
  defaults,
  description: "ETSI System B alphamosaics with 45-byte packet, Hamming-address and odd-parity channel faults",
  requiresGL: true });
