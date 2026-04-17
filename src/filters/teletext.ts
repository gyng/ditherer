import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderTeletextGL } from "./teletextGL";

const TELETEXT_COLORS: [number, number, number][] = [
  [0, 0, 0],       // black
  [255, 0, 0],     // red
  [0, 255, 0],     // green
  [255, 255, 0],   // yellow
  [0, 0, 255],     // blue
  [255, 0, 255],   // magenta
  [0, 255, 255],   // cyan
  [255, 255, 255]  // white
];

export const optionTypes = {
  columns: { type: RANGE, range: [20, 80], step: 1, default: 40, desc: "Character grid width" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance threshold per block cell" },
  blockGap: { type: RANGE, range: [0, 3], step: 1, default: 1, desc: "Pixel gap between character blocks" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columns: optionTypes.columns.default,
  threshold: optionTypes.threshold.default,
  blockGap: optionTypes.blockGap.default,
  palette: { ...optionTypes.palette.default, options: { levels: 8 } }
};

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

const nearestTeletextColor = (
  r: number,
  g: number,
  b: number
): [number, number, number] => {
  let bestDist = Infinity;
  let best = TELETEXT_COLORS[0];
  for (let i = 0; i < TELETEXT_COLORS.length; i++) {
    const c = TELETEXT_COLORS[i];
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
};

const teletext = (
  input: any,
  options: typeof defaults = defaults
) => {
  const { columns, threshold, blockGap, palette } = options;
  const W = input.width;
  const H = input.height;

  const cellW = Math.max(1, Math.floor(W / columns));
  const cellH = Math.max(1, Math.round(cellW * (10 / 12)));
  const rows = Math.ceil(H / cellH);
  const blockW = Math.max(1, Math.floor(cellW / 2));
  const blockH = Math.max(1, Math.floor(cellH / 3));

  const rendered = renderTeletextGL(input, W, H, columns, threshold, blockGap,
      cellW, cellH, rows, blockW, blockH,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Teletext", "WebGL2", `columns=${columns} cell=${cellW}x${cellH}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Teletext",
  func: teletext,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
