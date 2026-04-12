import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  tileSize: { type: RANGE, range: [4, 40], step: 1, default: 12, desc: "Tile size in pixels" },
  groutWidth: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "Gap between tiles" },
  groutColor: { type: COLOR, default: [60, 55, 50], desc: "Grout/mortar color" },
  jitter: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Random tile position variation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  tileSize: optionTypes.tileSize.default,
  groutWidth: optionTypes.groutWidth.default,
  groutColor: optionTypes.groutColor.default,
  jitter: optionTypes.jitter.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const mosaicTile = (input, options = defaults) => {
  const { tileSize, groutWidth, groutColor, jitter, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(42);

  const cellSize = tileSize + groutWidth;

  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      // Average color for this tile
      let tr = 0, tg = 0, tb = 0, cnt = 0;
      for (let dy = 0; dy < tileSize && cy + dy < H; dy++)
        for (let dx = 0; dx < tileSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          tr += buf[i]; tg += buf[i + 1]; tb += buf[i + 2]; cnt++;
        }
      if (cnt === 0) continue;
      tr = Math.round(tr / cnt); tg = Math.round(tg / cnt); tb = Math.round(tb / cnt);

      // Slight per-tile color jitter
      if (jitter > 0) {
        const j = (rng() - 0.5) * jitter * 40;
        tr = Math.max(0, Math.min(255, Math.round(tr + j)));
        tg = Math.max(0, Math.min(255, Math.round(tg + j)));
        tb = Math.max(0, Math.min(255, Math.round(tb + j)));
      }

      // Fill tile and grout
      for (let dy = 0; dy < cellSize && cy + dy < H; dy++) {
        for (let dx = 0; dx < cellSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          const inGrout = dx >= tileSize || dy >= tileSize;
          if (inGrout) {
            fillBufferPixel(outBuf, i, groutColor[0], groutColor[1], groutColor[2], 255);
          } else {
            const color = paletteGetColor(palette, rgba(tr, tg, tb, 255), palette.options, false);
            fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Mosaic Tile", func: mosaicTile, optionTypes, options: defaults, defaults });
