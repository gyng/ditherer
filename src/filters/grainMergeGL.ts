import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Grain-merge sharpening: separable box blur (horizontal + vertical
// passes) extracts a low-pass image, then a merge pass computes
// source + (source - blurred) * strength.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;     // (1/W, 0) or (0, 1/H)
uniform int   u_radius;

void main() {
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -10; k <= 10; k++) {
    if (k < -u_radius || k > u_radius) continue;
    vec2 uv = clamp(v_uv + u_dir * float(k),
                    vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv);
    cnt += 1.0;
  }
  fragColor = acc / max(1.0, cnt);
}
`;

const MERGE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform float u_strength;

void main() {
  vec4 src = texture(u_source,  v_uv);
  vec4 blr = texture(u_blurred, v_uv);
  vec3 hp = src.rgb - blr.rgb;
  vec3 merged = clamp(src.rgb + hp * u_strength, 0.0, 1.0);
  fragColor = vec4(merged, src.a);
}
`;

type Cache = { blur: Program; merge: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blur:  linkProgram(gl, BLUR_FS,  ["u_input", "u_res", "u_dir", "u_radius"] as const),
    merge: linkProgram(gl, MERGE_FS, ["u_source", "u_blurred", "u_strength"] as const),
  };
  return _cache;
};

export const grainMergeGLAvailable = (): boolean => glAvailable();

export const renderGrainMergeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  radius: number, strength: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (radius > 10) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  const srcTex = ensureTexture(gl, "grainMerge:src", width, height);
  uploadSourceTexture(gl, srcTex, source);

  const tempH = ensureTexture(gl, "grainMerge:tempH", width, height);
  const tempV = ensureTexture(gl, "grainMerge:tempV", width, height);

  drawPass(gl, tempH, width, height, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, width, height);
    gl.uniform2f(cache.blur.uniforms.u_dir, 1 / width, 0);
    gl.uniform1i(cache.blur.uniforms.u_radius, radius);
  }, vao);

  drawPass(gl, tempV, width, height, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tempH.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, width, height);
    gl.uniform2f(cache.blur.uniforms.u_dir, 0, 1 / height);
    gl.uniform1i(cache.blur.uniforms.u_radius, radius);
  }, vao);

  drawPass(gl, null, width, height, cache.merge, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex.tex);
    gl.uniform1i(cache.merge.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tempV.tex);
    gl.uniform1i(cache.merge.uniforms.u_blurred, 1);
    gl.uniform1f(cache.merge.uniforms.u_strength, strength);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
