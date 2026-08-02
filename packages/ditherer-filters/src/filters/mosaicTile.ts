import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

export const optionTypes = {
  tileSize: { type: RANGE, range: [4, 40], step: 1, default: 12, desc: "Tile size in pixels" },
  groutWidth: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "Gap between tiles" },
  groutColor: { type: COLOR, default: [60, 55, 50], desc: "Grout/mortar color" },
  jitter: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.2,
    label: "Brightness variation",
    desc: "Per-tile brightness variation",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  tileSize: optionTypes.tileSize.default,
  groutWidth: optionTypes.groutWidth.default,
  groutColor: optionTypes.groutColor.default,
  jitter: optionTypes.jitter.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

// Tile means are computed exactly once on the CPU and uploaded as a compact
// texture. The shader then performs only one tile lookup per output pixel.
const MT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_tiles;
uniform vec2  u_res;
uniform vec2  u_tileGridRes;
uniform float u_tileSize;
uniform float u_cellSize;
uniform vec3  u_groutColor;

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float cellX = floor(x / u_cellSize);
  float cellY = floor(y / u_cellSize);
  float localX = x - cellX * u_cellSize;
  float localY = y - cellY * u_cellSize;
  vec4 source = samplePx(x, y);

  // Grout zone: pixels past tileSize within the cell.
  if (localX >= u_tileSize || localY >= u_tileSize) {
    fragColor = vec4(u_groutColor, source.a);
    return;
  }

  vec2 tileUv = vec2((cellX + 0.5) / u_tileGridRes.x, 1.0 - (cellY + 0.5) / u_tileGridRes.y);
  vec3 rgb = texture(u_tiles, tileUv).rgb;
  fragColor = vec4(rgb, source.a);
}
`;

type Cache = { mt: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    mt: linkProgram(gl, MT_FS, [
      "u_source",
      "u_tiles",
      "u_res",
      "u_tileGridRes",
      "u_tileSize",
      "u_cellSize",
      "u_groutColor",
    ] as const),
  };
  return _cache;
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const validColor = (value: unknown, fallback: number[]): number[] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.slice(0, 3).every((channel) => typeof channel === "number" && Number.isFinite(channel))
    ? value.slice(0, 3).map((channel) => Math.max(0, Math.min(255, channel as number)))
    : fallback;

const cellHash = (cellX: number, cellY: number): number => {
  let hash = (Math.imul(cellX, 1664525) + Math.imul(cellY, 1013904223) + 42) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  return (hash & 0x00ffffff) / 16777216;
};

const mosaicTile = (
  input: any,
  options: Partial<typeof defaults> & { _webglAcceleration?: boolean } = defaults,
) => {
  const tileSize = Math.round(finite(options.tileSize, defaults.tileSize, 4, 40));
  const groutWidth = Math.round(finite(options.groutWidth, defaults.groutWidth, 1, 6));
  const groutColor = validColor(options.groutColor, defaults.groutColor);
  const jitter = finite(options.jitter, defaults.jitter, 0, 1);
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;
  const cellSize = tileSize + groutWidth;
  const inputCtx = input.getContext("2d", { willReadFrequently: true });
  if (!inputCtx) return input;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const gridW = Math.ceil(W / cellSize);
  const gridH = Math.ceil(H / cellSize);
  const tileCanvas = cloneCanvas(input, false);
  tileCanvas.width = gridW;
  tileCanvas.height = gridH;
  const tileCtx = tileCanvas.getContext("2d");
  if (!tileCtx) return input;
  const tileImage = tileCtx.createImageData(gridW, gridH);
  for (let cellY = 0; cellY < gridH; cellY++) {
    for (let cellX = 0; cellX < gridW; cellX++) {
      const cx = cellX * cellSize;
      const cy = cellY * cellSize;
      const maxX = Math.min(W, cx + tileSize);
      const maxY = Math.min(H, cy + tileSize);
      let tr = 0,
        tg = 0,
        tb = 0,
        alphaWeight = 0;
      for (let y = cy; y < maxY; y++) {
        for (let x = cx; x < maxX; x++) {
          const sourceIndex = getBufferIndex(x, y, W);
          const alpha = buf[sourceIndex + 3] / 255;
          tr += (buf[sourceIndex] / 255) * alpha;
          tg += (buf[sourceIndex + 1] / 255) * alpha;
          tb += (buf[sourceIndex + 2] / 255) * alpha;
          alphaWeight += alpha;
        }
      }
      if (alphaWeight > 1e-5) {
        tr /= alphaWeight;
        tg /= alphaWeight;
        tb /= alphaWeight;
      } else {
        tr = 0;
        tg = 0;
        tb = 0;
      }
      if (jitter > 0) {
        const variation = (cellHash(cellX, cellY) - 0.5) * jitter * (40 / 255);
        tr = Math.max(0, Math.min(1, tr + variation));
        tg = Math.max(0, Math.min(1, tg + variation));
        tb = Math.max(0, Math.min(1, tb + variation));
      }
      const tileIndex = (cellY * gridW + cellX) * 4;
      tileImage.data[tileIndex] = Math.round(tr * 255);
      tileImage.data[tileIndex + 1] = Math.round(tg * 255);
      tileImage.data[tileIndex + 2] = Math.round(tb * 255);
      tileImage.data[tileIndex + 3] = 255;
    }
  }
  tileCtx.putImageData(tileImage, 0, 0);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "mosaicTile:source", W, H);
      const tilesTex = ensureTexture(gl, "mosaicTile:tiles", gridW, gridH);
      uploadSourceTexture(gl, sourceTex, input);
      uploadSourceTexture(gl, tilesTex, tileCanvas);

      drawPass(
        gl,
        null,
        W,
        H,
        cache.mt,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.mt.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tilesTex.tex);
          gl.uniform1i(cache.mt.uniforms.u_tiles, 1);
          gl.uniform2f(cache.mt.uniforms.u_res, W, H);
          gl.uniform2f(cache.mt.uniforms.u_tileGridRes, gridW, gridH);
          gl.uniform1f(cache.mt.uniforms.u_tileSize, tileSize);
          gl.uniform1f(cache.mt.uniforms.u_cellSize, cellSize);
          gl.uniform3f(
            cache.mt.uniforms.u_groutColor,
            groutColor[0] / 255,
            groutColor[1] / 255,
            groutColor[2] / 255,
          );
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend(
            "Mosaic Tile",
            "WebGL2",
            `size=${tileSize}${identity ? "" : "+palettePass"}`,
          );
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Mosaic Tile", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const outBuf = new Uint8ClampedArray(buf.length);

  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      const tileIndex = (Math.floor(cy / cellSize) * gridW + Math.floor(cx / cellSize)) * 4;
      const tr = tileImage.data[tileIndex];
      const tg = tileImage.data[tileIndex + 1];
      const tb = tileImage.data[tileIndex + 2];

      // Fill tile and grout
      for (let dy = 0; dy < cellSize && cy + dy < H; dy++) {
        for (let dx = 0; dx < cellSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          const inGrout = dx >= tileSize || dy >= tileSize;
          if (inGrout) {
            outBuf[i] = groutColor[0];
            outBuf[i + 1] = groutColor[1];
            outBuf[i + 2] = groutColor[2];
          } else {
            outBuf[i] = tr;
            outBuf[i + 1] = tg;
            outBuf[i + 2] = tb;
          }
          outBuf[i + 3] = buf[i + 3];
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  return applyPalettePassToCanvas(output, W, H, palette) ?? output;
};

export default defineFilter({
  name: "Mosaic Tile",
  func: mosaicTile,
  optionTypes,
  options: defaults,
  defaults,
});
