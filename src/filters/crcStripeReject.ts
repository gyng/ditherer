import { ACTION, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, paletteGetColor, rgba } from "utils";

const PATTERN = {
  STRIPE: "STRIPE",
  TILE: "TILE",
};

const CONCEAL = {
  BLACK: "BLACK",
  HOLD: "HOLD",
  PREV_ROW: "PREV_ROW",
  NEAREST_VALID: "NEAREST_VALID",
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const optionTypes = {
  pattern: {
    type: ENUM,
    default: PATTERN.STRIPE,
    options: [
      { name: "Horizontal stripes", value: PATTERN.STRIPE },
      { name: "Tiles", value: PATTERN.TILE },
    ],
    desc: "Corruption region geometry"
  },
  rejectChance: { type: RANGE, range: [0, 1], step: 0.01, default: 0.16, desc: "Chance each stripe/tile fails CRC and gets rejected" },
  stripeHeight: { type: RANGE, range: [1, 96], step: 1, default: 8, desc: "Stripe height in pixels when pattern is stripes" },
  tileSize: { type: RANGE, range: [4, 160], step: 2, default: 24, desc: "Tile width/height in pixels when pattern is tiles" },
  conceal: {
    type: ENUM,
    default: CONCEAL.HOLD,
    options: [
      { name: "Black fill", value: CONCEAL.BLACK },
      { name: "Hold previous frame", value: CONCEAL.HOLD },
      { name: "Copy previous row", value: CONCEAL.PREV_ROW },
      { name: "Nearest valid", value: CONCEAL.NEAREST_VALID },
    ],
    desc: "Error concealment used for rejected regions"
  },
  jitter: { type: RANGE, range: [0, 32], step: 1, default: 3, desc: "Random region offset to mimic unstable packet boundaries" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  pattern: optionTypes.pattern.default,
  rejectChance: optionTypes.rejectChance.default,
  stripeHeight: optionTypes.stripeHeight.default,
  tileSize: optionTypes.tileSize.default,
  conceal: optionTypes.conceal.default,
  jitter: optionTypes.jitter.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type CrcStripeRejectOptions = FilterOptionValues & {
  pattern?: string;
  rejectChance?: number;
  stripeHeight?: number;
  tileSize?: number;
  conceal?: string;
  jitter?: number;
  animSpeed?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const crcStripeReject = (input: any, options: CrcStripeRejectOptions = defaults) => {
  const { pattern, rejectChance, stripeHeight, tileSize, conceal, jitter, palette } = options;
  const frameIndex = Number(options._frameIndex ?? 0);
  const prevOutput = options._prevOutput ?? null;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const w = input.width;
  const h = input.height;
  const src = inputCtx.getImageData(0, 0, w, h).data;
  const outBuf = new Uint8ClampedArray(src);

  const rng = mulberry32(frameIndex * 2851 + 17);

  const writePixel = (dstIndex: number, r: number, g: number, b: number, a: number) => {
    const c = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
    fillBufferPixel(outBuf, dstIndex, c[0], c[1], c[2], a);
  };

  const concealRegion = (x0: number, y0: number, x1: number, y1: number, isStripe: boolean) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const di = getBufferIndex(x, y, w);

        if (conceal === CONCEAL.BLACK) {
          writePixel(di, 0, 0, 0, 255);
          continue;
        }

        if (conceal === CONCEAL.HOLD && prevOutput && prevOutput.length === outBuf.length) {
          writePixel(di, prevOutput[di], prevOutput[di + 1], prevOutput[di + 2], prevOutput[di + 3]);
          continue;
        }

        if (conceal === CONCEAL.PREV_ROW) {
          const sy = Math.max(0, y - 1);
          const si = getBufferIndex(x, sy, w);
          writePixel(di, src[si], src[si + 1], src[si + 2], src[si + 3]);
          continue;
        }

        if (conceal === CONCEAL.NEAREST_VALID) {
          if (isStripe) {
            const sy = y0 > 0 ? y0 - 1 : Math.min(h - 1, y1);
            const si = getBufferIndex(x, sy, w);
            writePixel(di, src[si], src[si + 1], src[si + 2], src[si + 3]);
          } else {
            const leftX = x0 > 0 ? x0 - 1 : x1 < w ? x1 : x;
            const rightX = x1 < w ? x1 : x0 > 0 ? x0 - 1 : x;
            const useLeft = Math.abs(x - leftX) <= Math.abs(rightX - x);
            const sx = useLeft ? leftX : rightX;
            const si = getBufferIndex(sx, y, w);
            writePixel(di, src[si], src[si + 1], src[si + 2], src[si + 3]);
          }
          continue;
        }

        writePixel(di, 0, 0, 0, 255);
      }
    }
  };

  if (pattern === PATTERN.STRIPE) {
    const band = Math.max(1, Math.round(stripeHeight));
    for (let baseY = 0; baseY < h; baseY += band) {
      if (rng() >= rejectChance) continue;
      const offset = jitter > 0 ? Math.round((rng() * 2 - 1) * jitter) : 0;
      const y0 = Math.max(0, Math.min(h - 1, baseY + offset));
      const y1 = Math.min(h, y0 + band);
      concealRegion(0, y0, w, y1, true);
    }
  } else {
    const cell = Math.max(2, Math.round(tileSize));
    for (let baseY = 0; baseY < h; baseY += cell) {
      for (let baseX = 0; baseX < w; baseX += cell) {
        if (rng() >= rejectChance) continue;
        const jx = jitter > 0 ? Math.round((rng() * 2 - 1) * jitter) : 0;
        const jy = jitter > 0 ? Math.round((rng() * 2 - 1) * jitter) : 0;
        const x0 = Math.max(0, Math.min(w - 1, baseX + jx));
        const y0 = Math.max(0, Math.min(h - 1, baseY + jy));
        const x1 = Math.min(w, x0 + cell);
        const y1 = Math.min(h, y0 + cell);
        concealRegion(x0, y0, x1, y1, false);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, w, h), 0, 0);
  return output;
};

export default defineFilter({
  name: "CRC Stripe Reject",
  func: crcStripeReject,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Reject stripes or tiles like failed CRC packets, then conceal with hold, row-copy, or nearest-valid fill"
});
