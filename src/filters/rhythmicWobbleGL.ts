import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Whole-frame affine wobble: translate + rotate + zoom, driven by
// sinusoidal phases derived from frame index. Pulls from source via
// nearest-neighbour (matching the JS reference's `Math.round`).
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_offset;
uniform float u_cosA;
uniform float u_sinA;
uniform float u_zoom;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float cx = (u_res.x - 1.0) * 0.5;
  float cy = (u_res.y - 1.0) * 0.5;
  float dx = (jsX - cx) / u_zoom;
  float dy = (jsY - cy) / u_zoom;

  float srcX = clamp(floor(cx + dx * u_cosA - dy * u_sinA + u_offset.x + 0.5), 0.0, u_res.x - 1.0);
  float srcY = clamp(floor(cy + dx * u_sinA + dy * u_cosA + u_offset.y + 0.5), 0.0, u_res.y - 1.0);

  fragColor = texture(u_source, vec2((srcX + 0.5) / u_res.x, 1.0 - (srcY + 0.5) / u_res.y));
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_offset", "u_cosA", "u_sinA", "u_zoom",
  ] as const) };
  return _cache;
};

export const rhythmicWobbleGLAvailable = (): boolean => glAvailable();

export const renderRhythmicWobbleGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  offsetX: number, offsetY: number, angleRad: number, zoom: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "rhythmicWobble:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_offset, offsetX, offsetY);
    gl.uniform1f(cache.prog.uniforms.u_cosA, Math.cos(angleRad));
    gl.uniform1f(cache.prog.uniforms.u_sinA, Math.sin(angleRad));
    gl.uniform1f(cache.prog.uniforms.u_zoom, zoom);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
