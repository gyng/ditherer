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

// Brown-Conrady radial lens distortion. For each output pixel we invert the
// forward distortion model r_dst = r_src * (1 + k1·r² + k2·r⁴) via 8 Newton
// iterations (same count as the CPU/WASM reference), sample the source at
// the inverted radius, and emit. Matches the existing WASM path's math.
const LENS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_k1;
uniform float u_k2;
uniform float u_zoom;
uniform float u_levels;

float invertRadius(float rDst) {
  if (rDst == 0.0) return 0.0;
  float r = rDst;
  for (int n = 0; n < 8; n++) {
    float r2 = r * r;
    float r4 = r2 * r2;
    float f = r * (1.0 + u_k1 * r2 + u_k2 * r4) - rDst;
    float fp = 1.0 + 3.0 * u_k1 * r2 + 5.0 * u_k2 * r4;
    if (fp == 0.0) break;
    r -= f / fp;
  }
  return r;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  float norm = 1.0 / max(cx, cy);

  float dx = (x - cx) * norm / u_zoom;
  float dy = (y - cy) * norm / u_zoom;
  float rDst = sqrt(dx * dx + dy * dy);
  float rSrc = invertRadius(rDst);
  float scale = rDst > 0.0 ? rSrc / rDst : 1.0;
  float sx = cx + dx * scale / norm;
  float sy = cy + dy * scale / norm;

  if (sx < 0.0 || sx > u_res.x - 1.0 || sy < 0.0 || sy > u_res.y - 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Nearest-neighbour sample to match the CPU reference.
  vec2 uv = vec2((floor(sx) + 0.5) / u_res.x, 1.0 - (floor(sy) + 0.5) / u_res.y);
  vec4 sampled = texture(u_source, uv);
  vec3 rgb = sampled.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, sampled.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, LENS_FS, [
      "u_source", "u_res", "u_k1", "u_k2", "u_zoom", "u_levels",
    ] as const),
  };
  return _cache;
};

export const lensDistortionGLAvailable = (): boolean => glAvailable();

export const renderLensDistortionGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  k1: number,
  k2: number,
  zoom: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lensDistortion:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_k1, k1);
    gl.uniform1f(cache.prog.uniforms.u_k2, k2);
    gl.uniform1f(cache.prog.uniforms.u_zoom, zoom);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
