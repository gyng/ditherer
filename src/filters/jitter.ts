import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
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

export const optionTypes = {
  jitterX: { type: RANGE, range: [0, 100], default: 4, desc: "Maximum horizontal pixel displacement per row" },
  jitterXSpread: { type: RANGE, range: [0, 5], default: 0.5, step: 0.1, desc: "How much horizontal jitter carries over to the next row" },
  jitterY: { type: RANGE, range: [0, 100], default: 0, desc: "Maximum vertical pixel displacement per column" },
  jitterYSpread: { type: RANGE, range: [0, 5], default: 0.5, step: 0.1, desc: "How much vertical jitter carries over to the next column" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  jitterX: optionTypes.jitterX.default,
  jitterXSpread: optionTypes.jitterXSpread.default,
  jitterY: optionTypes.jitterY.default,
  jitterYSpread: optionTypes.jitterYSpread.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Jitter maps are built on CPU (sequential RNG chain with exponential
// carry-over — not parallelisable), pre-wrapped to [0, 1) of axis dim, and
// uploaded as RGBA8 normalised. R=dy/H, G=dx/W — shader rescales by res.
const JITTER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_maps;
uniform vec2  u_res;
uniform int   u_mapLen;

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // jitterYMap[x]: dy applied to x sampling
  float xIdx = clamp(x, 0.0, float(u_mapLen) - 1.0);
  float dy = texelFetch(u_maps, ivec2(int(xIdx), 0), 0).r * u_res.y;

  // jitterXMap[y]: dx applied to y sampling (same array, indexed by y —
  // JS path reuses the width-sized map here and just clamps).
  float yIdx = clamp(y, 0.0, float(u_mapLen) - 1.0);
  float dx = texelFetch(u_maps, ivec2(int(yIdx), 0), 0).g * u_res.x;

  float sx = mod(x + dy, u_res.x);
  float sy = mod(y + dx, u_res.y);
  fragColor = samplePx(sx, sy);
}
`;

type Cache = { prog: Program; mapTex: WebGLTexture | null; mapLen: number };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, JITTER_FS, ["u_source", "u_maps", "u_res", "u_mapLen"] as const),
    mapTex: null,
    mapLen: 0,
  };
  return _cache;
};

const ensureMapTex = (gl: WebGL2RenderingContext, cache: Cache, len: number) => {
  if (cache.mapTex && cache.mapLen === len) return cache.mapTex;
  if (cache.mapTex) gl.deleteTexture(cache.mapTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, len, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.mapTex = tex;
  cache.mapLen = len;
  return tex;
};

const jitterFilter = (
  input: any,
  options = defaults
) => {
  const { jitterX, jitterXSpread, jitterY, jitterYSpread, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width;
  const H = input.height;

  // Build both jitter maps — sequential dependency forces CPU.
  const rng = mulberry32(frameIndex * 7919 + 31337);
  const jitterYMap = new Int32Array(W);
  const jitterXMap = new Int32Array(W);
  let jitterFactor = 0;
  for (let i = 0; i < W; i++) {
    jitterFactor += rng() * jitterY;
    jitterYMap[i] = Math.round(jitterFactor);
    jitterFactor *= jitterYSpread;
  }
  jitterFactor = 0;
  for (let i = 0; i < W; i++) {
    jitterFactor += rng() * jitterX;
    jitterXMap[i] = Math.round(jitterFactor);
    jitterFactor *= jitterXSpread;
  }

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "jitter:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const mapTex = ensureMapTex(gl, cache, W);
      if (mapTex) {
        // Pre-wrap to [0, axis) then encode as a fraction 0..255 of the
        // axis dim. Shader multiplies by res.x/res.y to recover the pixel
        // offset, then applies mod(axis) again which is idempotent.
        const bytes = new Uint8Array(W * 4);
        for (let i = 0; i < W; i++) {
          const dy = ((jitterYMap[i] % H) + H) % H;
          const dx = ((jitterXMap[i] % W) + W) % W;
          bytes[i * 4] = Math.min(254, Math.round(dy / H * 255));
          bytes[i * 4 + 1] = Math.min(254, Math.round(dx / W * 255));
        }
        gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        drawPass(gl, null, W, H, cache.prog, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.prog.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, mapTex);
          gl.uniform1i(cache.prog.uniforms.u_maps, 1);
          gl.uniform2f(cache.prog.uniforms.u_res, W, H);
          gl.uniform1i(cache.prog.uniforms.u_mapLen, W);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const identity = paletteIsIdentity(palette);
          const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("Jitter", "WebGL2",
              `x=${jitterX} y=${jitterY}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }

  logFilterWasmStatus("Jitter", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const jI = getBufferIndex(
        (x + jitterYMap[x]) % W,
        (y + jitterXMap[y]) % H,
        W
      );

      const pixel = rgba(buf[jI], buf[jI + 1], buf[jI + 2], buf[jI + 3]);
      const color = paletteGetColor(palette, pixel, palette.options, false);
      fillBufferPixel(buf, i, color[0], color[1], color[2], color[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Jitter",
  func: jitterFilter,
  options: defaults,
  optionTypes,
  defaults
});
