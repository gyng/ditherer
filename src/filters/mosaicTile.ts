import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor,
  logFilterBackend, logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

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

// Shader: compute cell grid per pixel, sample source at cell centre (fast
// proxy for per-cell average), apply per-tile hash-based colour jitter,
// emit grout colour for pixels in the gap zone.
const MT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_tileSize;
uniform float u_cellSize;
uniform float u_groutWidth;
uniform vec3  u_groutColor;
uniform float u_jitter;
uniform float u_levels;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y)).rgb;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float cellX = floor(x / u_cellSize);
  float cellY = floor(y / u_cellSize);
  float localX = x - cellX * u_cellSize;
  float localY = y - cellY * u_cellSize;

  // Grout zone: pixels past tileSize within the cell.
  if (localX >= u_tileSize || localY >= u_tileSize) {
    vec3 gc = u_groutColor;
    if (u_levels > 1.5) {
      float q = u_levels - 1.0;
      gc = floor(gc * q + 0.5) / q;
    }
    fragColor = vec4(gc, 1.0);
    return;
  }

  // Sample source at cell centre.
  float scx = clamp(cellX * u_cellSize + u_tileSize * 0.5, 0.0, u_res.x - 1.0);
  float scy = clamp(cellY * u_cellSize + u_tileSize * 0.5, 0.0, u_res.y - 1.0);
  vec3 rgb = samplePx(scx, scy);

  // Per-tile colour jitter.
  if (u_jitter > 0.0) {
    float j = (hash(vec2(cellX, cellY), 42.0) - 0.5) * u_jitter * (40.0 / 255.0);
    rgb = clamp(rgb + vec3(j), 0.0, 1.0);
  }

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { mt: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    mt: linkProgram(gl, MT_FS, [
      "u_source", "u_res", "u_tileSize", "u_cellSize", "u_groutWidth",
      "u_groutColor", "u_jitter", "u_levels",
    ] as const),
  };
  return _cache;
};

const mosaicTile = (input: any, options = defaults) => {
  const { tileSize, groutWidth, groutColor, jitter, palette } = options;
  const W = input.width, H = input.height;
  const cellSize = tileSize + groutWidth;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "mosaicTile:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.mt, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.mt.uniforms.u_source, 0);
        gl.uniform2f(cache.mt.uniforms.u_res, W, H);
        gl.uniform1f(cache.mt.uniforms.u_tileSize, tileSize);
        gl.uniform1f(cache.mt.uniforms.u_cellSize, cellSize);
        gl.uniform1f(cache.mt.uniforms.u_groutWidth, groutWidth);
        gl.uniform3f(cache.mt.uniforms.u_groutColor, groutColor[0] / 255, groutColor[1] / 255, groutColor[2] / 255);
        gl.uniform1f(cache.mt.uniforms.u_jitter, jitter);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.mt.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Mosaic Tile", "WebGL2", `size=${tileSize}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Mosaic Tile", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(42);

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
