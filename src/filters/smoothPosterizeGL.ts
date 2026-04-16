import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Posterise with smooth transitions near band edges. Matches the JS
// reference's per-channel transfer function exactly.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_step;
uniform float u_transitionWidth;
uniform float u_halfStep;

float smoothBand(float v) {
  float bandCenter = floor(v / u_step + 0.5) * u_step;
  if (u_transitionWidth < 1.0) return bandCenter;
  float distToEdge = abs(v - bandCenter);
  if (distToEdge > u_halfStep - u_transitionWidth) {
    float nextBand = v > bandCenter
      ? min(255.0, bandCenter + u_step)
      : max(0.0, bandCenter - u_step);
    float t = (distToEdge - (u_halfStep - u_transitionWidth)) / (u_transitionWidth * 2.0);
    float sT = t * t * (3.0 - 2.0 * t);
    return bandCenter + (nextBand - bandCenter) * sT;
  }
  return bandCenter;
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb = c.rgb * 255.0;
  rgb = vec3(smoothBand(rgb.r), smoothBand(rgb.g), smoothBand(rgb.b));
  rgb = clamp(floor(rgb + 0.5), 0.0, 255.0);
  fragColor = vec4(rgb / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_step", "u_transitionWidth", "u_halfStep",
  ] as const) };
  return _cache;
};

export const smoothPosterizeGLAvailable = (): boolean => glAvailable();

export const renderSmoothPosterizeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  levels: number, smoothness: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "smoothPosterize:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const step = 255 / (levels - 1);
  const transitionWidth = step * smoothness * 0.5;
  const halfStep = step / 2;
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_step, step);
    gl.uniform1f(cache.prog.uniforms.u_transitionWidth, transitionWidth);
    gl.uniform1f(cache.prog.uniforms.u_halfStep, halfStep);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
