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

// Pass 1: horizontal box blur of the source (RGB only — alpha passthrough).
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
  for (int k = -10; k <= 10; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    acc += texture(u_input, (vec2(nx, y) + 0.5) / u_res);
    cnt += 1.0;
  }
  fragColor = acc / cnt;
}
`;

// Pass 2 (final): vertical box blur of temp + daguerreotype tone composite.
//   blurred → silver-blue tonal curve driven by luminance
//   metallic sheen adds pow(L, 0.5) highlight
//   oval vignette (horizontal major axis) darkens edges
const DAG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_blurH;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_silverTone;
uniform float u_vignette;
uniform float u_metallic;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_gl = floor(px.y);
  // Vertical blur accumulator in RGBA, averaged across the kernel.
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -10; k <= 10; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(y_gl + float(k), 0.0, u_res.y - 1.0);
    acc += texture(u_blurH, (vec2(x, ny) + 0.5) / u_res);
    cnt += 1.0;
  }
  vec4 blurred = acc / cnt;
  vec3 b255 = blurred.rgb * 255.0;

  float lum = (0.2126 * b255.r + 0.7152 * b255.g + 0.0722 * b255.b) / 255.0;
  vec3 tone = vec3(
    lum * (180.0 + u_silverTone * 40.0),
    lum * (185.0 + u_silverTone * 30.0),
    lum * (200.0 + u_silverTone * 55.0)
  );

  if (u_metallic > 0.0) {
    float highlight = pow(lum, 0.5) * u_metallic * 60.0;
    tone += vec3(highlight, highlight, highlight * 1.1);
  }

  if (u_vignette > 0.0) {
    // Work in JS-y so the oval orientation matches the CPU reference.
    float y_js = u_res.y - 1.0 - y_gl;
    float cx = u_res.x * 0.5;
    float cy = u_res.y * 0.5;
    float dx = (x - cx) / cx;
    float dy = (y_js - cy) / cy;
    float dist = sqrt(dx * dx * 1.5 + dy * dy * 1.5);
    float vig = max(0.0, 1.0 - pow(max(0.0, dist - 0.3) / 0.7, 2.0));
    float factor = 1.0 - (1.0 - vig) * u_vignette;
    tone *= factor;
  }

  vec3 rgb = clamp(floor(tone + 0.5), 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { blurH: Program; final: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blurH: linkProgram(gl, BLUR_H_FS, ["u_input", "u_res", "u_radius"] as const),
    final: linkProgram(gl, DAG_FS, [
      "u_blurH", "u_res", "u_radius", "u_silverTone", "u_vignette", "u_metallic", "u_levels",
    ] as const),
  };
  return _cache;
};

export const daguerreotypeGLAvailable = (): boolean => glAvailable();

export const renderDaguerreotypeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  silverTone: number,
  softFocus: number,
  vignette: number,
  metallic: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const radius = Math.max(1, Math.min(10, Math.round(softFocus)));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "daguerreotype:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const temp = ensureTexture(gl, "daguerreotype:blurH", width, height);

  drawPass(gl, temp, width, height, cache.blurH, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.blurH.uniforms.u_input, 0);
    gl.uniform2f(cache.blurH.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurH.uniforms.u_radius, radius);
  }, vao);

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp.tex);
    gl.uniform1i(cache.final.uniforms.u_blurH, 0);
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform1i(cache.final.uniforms.u_radius, radius);
    gl.uniform1f(cache.final.uniforms.u_silverTone, silverTone);
    gl.uniform1f(cache.final.uniforms.u_vignette, vignette);
    gl.uniform1f(cache.final.uniforms.u_metallic, metallic);
    gl.uniform1f(cache.final.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
