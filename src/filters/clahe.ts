import { RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor, logFilterBackend } from "utils";
import { claheGLAvailable, renderClaheGL } from "./claheGL";

export const optionTypes = {
  tileSize: { type: RANGE, range: [8, 64], step: 4, default: 32, desc: "Size of local histogram regions" },
  clipLimit: { type: RANGE, range: [1, 10], step: 0.5, default: 3, desc: "Contrast amplification limit" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  tileSize: optionTypes.tileSize.default,
  clipLimit: optionTypes.clipLimit.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type ClaheOptions = FilterOptionValues & {
  tileSize?: number;
  clipLimit?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
};

const clahe = (input: any, options: ClaheOptions = defaults) => {
  const {
    tileSize = defaults.tileSize,
    clipLimit = defaults.clipLimit,
    palette = defaults.palette,
  } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Compute luminance
  const lum = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = Math.round(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]);
    }

  // Tile grid
  const tilesX = Math.max(1, Math.ceil(W / tileSize));
  const tilesY = Math.max(1, Math.ceil(H / tileSize));

  // Compute CDF per tile
  const cdfs: Uint8Array[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileSize, y0 = ty * tileSize;
      const x1 = Math.min(x0 + tileSize, W), y1 = Math.min(y0 + tileSize, H);
      const pixels = (x1 - x0) * (y1 - y0);

      // Histogram
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          hist[lum[y * W + x]]++;

      // Clip and redistribute
      const limit = Math.max(1, Math.round(clipLimit * pixels / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
      }
      const perBin = Math.floor(excess / 256);
      const remainder = excess - perBin * 256;
      for (let i = 0; i < 256; i++) hist[i] += perBin;
      for (let i = 0; i < remainder; i++) hist[i]++;

      // CDF
      const cdf = new Uint8Array(256);
      let cumSum = 0;
      for (let i = 0; i < 256; i++) {
        cumSum += hist[i];
        cdf[i] = Math.round((cumSum / pixels) * 255);
      }
      cdfs.push(cdf);
    }
  }

  const getCdf = (tx: number, ty: number) => cdfs[ty * tilesX + tx];

  // GL fast path: CDF build ran on CPU (histograms don't port well to GPU);
  // the bilinear-interpolated CDF lookup per pixel runs in a fragment shader.
  // Only taken when the palette is nearest so RGB scaling stays consistent.
  if (
    claheGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
    && (palette as { name?: string }).name === "nearest"
  ) {
    const rendered = renderClaheGL(input, W, H, tileSize, cdfs, tilesX, tilesY);
    if (rendered) {
      logFilterBackend("CLAHE", "WebGL2", `tileSize=${tileSize} clipLimit=${clipLimit} tiles=${tilesX}x${tilesY}`);
      return rendered;
    }
  }

  // Apply with bilinear interpolation between tiles
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const l = lum[y * W + x];

      // Find surrounding tile centers
      const txf = (x + 0.5) / tileSize - 0.5;
      const tyf = (y + 0.5) / tileSize - 0.5;
      const tx0 = Math.max(0, Math.floor(txf));
      const ty0 = Math.max(0, Math.floor(tyf));
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty1 = Math.min(tilesY - 1, ty0 + 1);
      const fx = Math.max(0, Math.min(1, txf - tx0));
      const fy = Math.max(0, Math.min(1, tyf - ty0));

      // Interpolate CDF values
      const v00 = getCdf(tx0, ty0)[l];
      const v10 = getCdf(tx1, ty0)[l];
      const v01 = getCdf(tx0, ty1)[l];
      const v11 = getCdf(tx1, ty1)[l];
      const mapped = v00 * (1-fx) * (1-fy) + v10 * fx * (1-fy) + v01 * (1-fx) * fy + v11 * fx * fy;

      // Scale original RGB proportionally
      const scale = l > 0 ? mapped / l : 1;
      const r = Math.max(0, Math.min(255, Math.round(buf[i] * scale)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] * scale)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] * scale)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "CLAHE", func: clahe, optionTypes, options: defaults, defaults });
