import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// TPDF triangular noise dither + per-channel levels quantisation.
// Only covers the LEVELS palette mode; custom colour palettes fall
// back to the WASM/JS path on the caller side. The per-pixel hash
// uses a time-varying seed so animations break streaks, mirroring the
// JS Math.random() run-to-run variation.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform uint  u_seed;
uniform float u_levels;

uint hash32(int x, int y, uint seed) {
  uint h = seed + uint(x) * 374761393u + uint(y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

float hashF01(int x, int y, uint seed) {
  return float(hash32(x, y, seed)) / 4294967296.0;
}

float tpdf(int x, int y) {
  float a = hashF01(x, y, u_seed);
  float b = hashF01(x, y, u_seed + 0x9E3779B9u);
  return a - b;
}

void main() {
  vec2 px = v_uv * u_res;
  int jsX = int(floor(px.x));
  int jsY = int(u_res.y - 1.0 - floor(px.y));

  vec4 c = texture(u_source, vec2((float(jsX) + 0.5) / u_res.x, 1.0 - (float(jsY) + 0.5) / u_res.y));
  vec3 rgb = c.rgb * 255.0;

  float n = tpdf(jsX, jsY) * 0.5 * 255.0;
  rgb += vec3(n);

  if (u_levels > 1.5 && u_levels < 255.5) {
    float step = 255.0 / (u_levels - 1.0);
    rgb = clamp(floor(rgb / step + 0.5) * step, 0.0, 255.0);
  } else {
    rgb = clamp(floor(rgb + 0.5), 0.0, 255.0);
  }
  fragColor = vec4(rgb / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_seed", "u_levels",
  ] as const) };
  return _cache;
};

export const triangleDitherGLAvailable = (): boolean => glAvailable();

export const renderTriangleDitherGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  seed: number, levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "triangleDither:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1ui(cache.prog.uniforms.u_seed, seed >>> 0);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
