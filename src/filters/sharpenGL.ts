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

// Pass 1: horizontal box blur of source RGB (alpha carried through).
const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  vec2 px = v_uv * u_res;
  float y = floor(px.y);
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -20; k <= 20; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    acc += texture(u_input, (vec2(nx, y) + 0.5) / u_res);
    cnt += 1.0;
  }
  fragColor = acc / cnt;
}
`;

// Pass 2 (final): vertical box blur + unsharp-mask composite against source.
//   out = src + (src - blurred) * strength, gated by |Δ| > threshold*3 (sum).
const SHARPEN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_blurH;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_strength;
uniform float u_threshold;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_gl = floor(px.y);

  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -20; k <= 20; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(y_gl + float(k), 0.0, u_res.y - 1.0);
    acc += texture(u_blurH, (vec2(x, ny) + 0.5) / u_res);
    cnt += 1.0;
  }
  vec4 blurred = acc / cnt;

  vec4 src = texture(u_source, v_uv);
  vec3 s255 = src.rgb * 255.0;
  vec3 b255 = blurred.rgb * 255.0;
  vec3 d = s255 - b255;
  float diff = abs(d.r) + abs(d.g) + abs(d.b);

  vec3 outRgb;
  if (diff < u_threshold * 3.0) {
    outRgb = s255;
  } else {
    outRgb = clamp(s255 + d * u_strength, 0.0, 255.0);
  }
  vec3 rgb = floor(outRgb + 0.5) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { blurH: Program; final: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blurH: linkProgram(gl, BLUR_H_FS, ["u_input", "u_res", "u_radius"] as const),
    final: linkProgram(gl, SHARPEN_FS, [
      "u_source", "u_blurH", "u_res", "u_radius",
      "u_strength", "u_threshold", "u_levels",
    ] as const),
  };
  return _cache;
};

export const sharpenGLAvailable = (): boolean => glAvailable();

export const renderSharpenGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  strength: number,
  radius: number,
  threshold: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const r = Math.max(1, Math.min(20, Math.round(radius)));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "sharpen:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const temp = ensureTexture(gl, "sharpen:blurH", width, height);

  drawPass(gl, temp, width, height, cache.blurH, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.blurH.uniforms.u_input, 0);
    gl.uniform2f(cache.blurH.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurH.uniforms.u_radius, r);
  }, vao);

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.final.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, temp.tex);
    gl.uniform1i(cache.final.uniforms.u_blurH, 1);
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform1i(cache.final.uniforms.u_radius, r);
    gl.uniform1f(cache.final.uniforms.u_strength, strength);
    gl.uniform1f(cache.final.uniforms.u_threshold, threshold);
    gl.uniform1f(cache.final.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
