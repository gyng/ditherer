import { RANGE, BOOL, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  clamp,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
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
} from "gl";

const getTriangleCell = (x: number, y: number, size: number): [number, number, number] => {
  const tx = Math.floor(x / size);
  const ty = Math.floor(y / size);
  const localX = x - tx * size;
  const localY = y - ty * size;
  const up = localX + localY < size;
  return [tx, ty, up ? 0 : 1];
};

const sameCell = (a: [number, number, number], b: [number, number, number]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const getTriangleSample = (tx: number, ty: number, tri: number, size: number): [number, number] => {
  const baseX = tx * size;
  const baseY = ty * size;
  if (tri === 0) return [baseX + size / 3, baseY + size / 3];
  return [baseX + size * 2 / 3, baseY + size * 2 / 3];
};

export const optionTypes = {
  cellSize: { type: RANGE, range: [4, 64], step: 1, default: 16, desc: "Triangle cell size in pixels" },
  outline: { type: BOOL, default: false, desc: "Draw seams between neighboring triangle cells" },
  outlineColor: { type: COLOR, default: [0, 0, 0], desc: "Outline color when seam drawing is enabled" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  outline: optionTypes.outline.default,
  outlineColor: optionTypes.outlineColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Each axis-aligned square cell is split diagonally into two triangles
// (0=upper-left, 1=lower-right) using `localX + localY < size`. Sample
// point is at (1/3, 1/3) or (2/3, 2/3) of the cell.
const TP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_size;
uniform int   u_outline;
uniform vec3  u_outlineColor;

vec3 cellOf(float x, float y) {
  float tx = floor(x / u_size);
  float ty = floor(y / u_size);
  float lx = x - tx * u_size;
  float ly = y - ty * u_size;
  float up = (lx + ly) < u_size ? 0.0 : 1.0;
  return vec3(tx, ty, up);
}

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 cell = cellOf(x, y);
  if (u_outline == 1) {
    vec3 right = cellOf(min(u_res.x - 1.0, x + 1.0), y);
    vec3 down  = cellOf(x, min(u_res.y - 1.0, y + 1.0));
    if (right != cell || down != cell) {
      fragColor = vec4(u_outlineColor, 1.0);
      return;
    }
  }

  float baseX = cell.x * u_size;
  float baseY = cell.y * u_size;
  float frac = cell.z < 0.5 ? 1.0 / 3.0 : 2.0 / 3.0;
  float sx = baseX + u_size * frac;
  float sy = baseY + u_size * frac;
  fragColor = samplePx(sx, sy);
}
`;

type Cache = { tp: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    tp: linkProgram(gl, TP_FS, [
      "u_source", "u_res", "u_size", "u_outline", "u_outlineColor",
    ] as const),
  };
  return _cache;
};

const trianglePixelate = (input: any, options = defaults) => {
  const { cellSize, outline, outlineColor, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "trianglePixelate:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.tp, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.tp.uniforms.u_source, 0);
        gl.uniform2f(cache.tp.uniforms.u_res, W, H);
        gl.uniform1f(cache.tp.uniforms.u_size, cellSize);
        gl.uniform1i(cache.tp.uniforms.u_outline, outline ? 1 : 0);
        gl.uniform3f(cache.tp.uniforms.u_outlineColor, outlineColor[0] / 255, outlineColor[1] / 255, outlineColor[2] / 255);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Triangle Pixelate", "WebGL2",
            `size=${cellSize}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Triangle Pixelate", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = getTriangleCell(x, y, cellSize);
      const i = getBufferIndex(x, y, W);

      if (outline) {
        const right = getTriangleCell(Math.min(W - 1, x + 1), y, cellSize);
        const down = getTriangleCell(x, Math.min(H - 1, y + 1), cellSize);
        if (!sameCell(cell, right) || !sameCell(cell, down)) {
          outBuf[i] = outlineColor[0];
          outBuf[i + 1] = outlineColor[1];
          outBuf[i + 2] = outlineColor[2];
          outBuf[i + 3] = 255;
          continue;
        }
      }

      const [sxRaw, syRaw] = getTriangleSample(cell[0], cell[1], cell[2], cellSize);
      const sx = clamp(0, W - 1, Math.round(sxRaw));
      const sy = clamp(0, H - 1, Math.round(syRaw));
      const si = getBufferIndex(sx, sy, W);
      const color = srgbPaletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]), palette.options);

      outBuf[i] = color[0];
      outBuf[i + 1] = color[1];
      outBuf[i + 2] = color[2];
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Triangle Pixelate",
  func: trianglePixelate,
  optionTypes,
  options: defaults,
  defaults
});
