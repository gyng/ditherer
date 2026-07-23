import { RANGE, PALETTE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { nearest } from "../palettes/index";
import { cloneCanvas, getBufferIndex, logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { claheGLAvailable, renderClaheGL } from "./claheGL";

export const optionTypes = {
  tileSize: { type: RANGE, range: [8, 64], step: 4, default: 32, desc: "Size of local histogram regions" },
  clipLimit: { type: RANGE, range: [1, 10], step: 0.5, default: 3, desc: "Contrast amplification limit" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
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
  const parsedTileSize = typeof options.tileSize === "number" ? options.tileSize : Number.NaN;
  const parsedClipLimit = typeof options.clipLimit === "number" ? options.clipLimit : Number.NaN;
  const tileSize = Math.round(Math.max(8, Math.min(64,
    Number.isFinite(parsedTileSize) ? parsedTileSize : defaults.tileSize)) / 4) * 4;
  const clipLimit = Math.max(1, Math.min(10,
    Number.isFinite(parsedClipLimit) ? parsedClipLimit : defaults.clipLimit));
  const palette = options.palette ?? defaults.palette;
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
  const validTiles: boolean[] = [];
  const reflect101 = (coordinate: number, size: number) => {
    if (size <= 1) return 0;
    const period = 2 * size - 2;
    const wrapped = ((coordinate % period) + period) % period;
    return wrapped < size ? wrapped : period - wrapped;
  };
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileSize, y0 = ty * tileSize;
      // Histogram
      const hist = new Uint32Array(256);
      let pixels = 0;
      for (let dy = 0; dy < tileSize; dy++)
        for (let dx = 0; dx < tileSize; dx++) {
          const x = reflect101(x0 + dx, W);
          const y = reflect101(y0 + dy, H);
          const pixelIndex = getBufferIndex(x, y, W);
          if (buf[pixelIndex + 3] === 0) continue;
          hist[lum[y * W + x]]++;
          pixels++;
        }

      if (pixels === 0) {
        const identity = new Uint8Array(256);
        for (let i = 0; i < 256; i++) identity[i] = i;
        cdfs.push(identity);
        validTiles.push(false);
        continue;
      }
      validTiles.push(true);

      // Clip and redistribute
      const limit = Math.max(1, Math.round(clipLimit * pixels / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
      }
      const perBin = Math.floor(excess / 256);
      const remainder = excess - perBin * 256;
      for (let i = 0; i < 256; i++) hist[i] += perBin;
      if (remainder > 0) {
        const residualStep = Math.max(1, Math.floor(256 / remainder));
        for (let i = 0, remaining = remainder; i < 256 && remaining > 0; i += residualStep, remaining--) hist[i]++;
      }

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

  if (validTiles.some(Boolean)) {
    const nearest = new Int32Array(cdfs.length);
    nearest.fill(-1);
    const queue = new Int32Array(cdfs.length);
    let head = 0;
    let tail = 0;
    for (let tile = 0; tile < cdfs.length; tile++) {
      if (!validTiles[tile]) continue;
      nearest[tile] = tile;
      queue[tail++] = tile;
    }
    while (head < tail) {
      const tile = queue[head++];
      const tx = tile % tilesX;
      const ty = Math.floor(tile / tilesX);
      const visit = (candidate: number) => {
        if (nearest[candidate] >= 0) return;
        nearest[candidate] = nearest[tile];
        queue[tail++] = candidate;
      };
      if (tx > 0) visit(tile - 1);
      if (tx + 1 < tilesX) visit(tile + 1);
      if (ty > 0) visit(tile - tilesX);
      if (ty + 1 < tilesY) visit(tile + tilesX);
    }
    for (let tile = 0; tile < cdfs.length; tile++) {
      if (!validTiles[tile] && nearest[tile] >= 0) cdfs[tile] = cdfs[nearest[tile]];
    }
  }

  const getCdf = (tx: number, ty: number) => cdfs[ty * tilesX + tx];

  // GL fast path: CDF build ran on CPU (histograms don't port well to GPU);
  // the bilinear-interpolated CDF lookup per pixel runs in a fragment shader.
  // Only taken when the palette is nearest so RGB scaling stays consistent.
  if (
    claheGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const identity = paletteIsIdentity(palette);
    const rendered = renderClaheGL(input, W, H, tileSize, cdfs, tilesX, tilesY);
    if (rendered) {
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("CLAHE", "WebGL2", `tileSize=${tileSize} clipLimit=${clipLimit} tiles=${tilesX}x${tilesY}${identity ? "" : "+palettePass"}`);
        return out;
      }
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
      const scale = l > 0 ? mapped / l : 0;
      const r = Math.max(0, Math.min(255, Math.round(l > 0 ? buf[i] * scale : mapped)));
      const g = Math.max(0, Math.min(255, Math.round(l > 0 ? buf[i + 1] * scale : mapped)));
      const b = Math.max(0, Math.min(255, Math.round(l > 0 ? buf[i + 2] * scale : mapped)));

      outBuf[i] = r;
      outBuf[i + 1] = g;
      outBuf[i + 2] = b;
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  return applyPalettePassToCanvas(output, W, H, palette) ?? output;
};

export default defineFilter({ name: "CLAHE", func: clahe, optionTypes, options: defaults, defaults });
