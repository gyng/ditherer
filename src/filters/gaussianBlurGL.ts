// WebGL2 Gaussian blur: two-pass separable, Gaussian weights computed per
// fragment (kernel up to radius=64 samples, which covers the filter's
// sigma≤20 range at 3σ). Orientation matches the rest of the GL pipeline:
// inputs uploaded with UNPACK_FLIP_Y_WEBGL=true, final drawImage lands
// right-side-up on the returned 2D canvas.

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

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;     // (1/W, 0) for horizontal pass; (0, 1/H) for vertical.
uniform float u_sigma;
uniform int   u_radius;

void main() {
  float twoSigmaSq = 2.0 * u_sigma * u_sigma;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  // Static loop bound so the driver can unroll; the radius check short-
  // circuits the unused taps. 64 covers sigma=20 at 3σ radius (=60).
  for (int k = -64; k <= 64; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / twoSigmaSq);
    vec2 uv = clamp(v_uv + u_dir * fk,
                    vec2(0.5) / u_res,
                    vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, ["u_input", "u_res", "u_dir", "u_sigma", "u_radius"] as const),
  };
  return _cache;
};

export const gaussianBlurGLAvailable = (): boolean => glAvailable();

export const renderGaussianBlurGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  sigma: number,
): HTMLCanvasElement | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  const radius = Math.min(64, Math.ceil(sigma * 3));

  resizeGLCanvas(canvas, width, height);

  const inputEntry = ensureTexture(gl, "gauss:input", width, height);
  uploadSourceTexture(gl, inputEntry, source);

  // Horizontal pass → scratch.
  const temp = ensureTexture(gl, "gauss:temp", width, height);
  drawPass(gl, temp, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputEntry.tex);
    gl.uniform1i(cache.prog.uniforms.u_input, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_dir, 1 / width, 0);
    gl.uniform1f(cache.prog.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.prog.uniforms.u_radius, radius);
  }, vao);

  // Vertical pass → gl canvas.
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp.tex);
    gl.uniform1i(cache.prog.uniforms.u_input, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_dir, 0, 1 / height);
    gl.uniform1f(cache.prog.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.prog.uniforms.u_radius, radius);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
