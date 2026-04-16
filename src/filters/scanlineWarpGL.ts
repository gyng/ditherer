import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-row horizontal sinusoidal warp with bilinear source sampling.
// Matches the JS reference's shift formula and bilinear taps.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_phase;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float shift = u_amplitude * sin(jsY * u_frequency * 6.28318530718 / u_res.y + u_phase);
  float srcX = jsX + shift;
  float x0 = floor(srcX);
  float x1 = x0 + 1.0;
  float fx = srcX - x0;
  float sx0 = clamp(x0, 0.0, u_res.x - 1.0);
  float sx1 = clamp(x1, 0.0, u_res.x - 1.0);

  vec3 c0 = texture(u_source, vec2((sx0 + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb;
  vec3 c1 = texture(u_source, vec2((sx1 + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb;
  vec3 rgb = clamp(c0 * (1.0 - fx) + c1 * fx, 0.0, 1.0);
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_amplitude", "u_frequency", "u_phase",
  ] as const) };
  return _cache;
};

export const scanlineWarpGLAvailable = (): boolean => glAvailable();

export const renderScanlineWarpGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  amplitude: number, frequency: number, phaseRad: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "scanlineWarp:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_amplitude, amplitude);
    gl.uniform1f(cache.prog.uniforms.u_frequency, frequency);
    gl.uniform1f(cache.prog.uniforms.u_phase, phaseRad);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
