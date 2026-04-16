import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Zigzag line pattern: luminance drives line thickness, sawtooth
// displaces the ridge along its tangent direction. Output is binary
// black/white.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_lineSpacing;
uniform float u_amplitude;
uniform float u_cosA;
uniform float u_sinA;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb * 255.0;
  float luma = src.r * 0.2126 + src.g * 0.7152 + src.b * 0.0722;
  float darkness = 1.0 - luma / 255.0;

  float perpDist = jsX * u_sinA - jsY * u_cosA;
  float parDist  = jsX * u_cosA + jsY * u_sinA;

  float period = u_lineSpacing * 2.0;
  float rawMod = mod(parDist, period);
  float sawPhase = mod(rawMod + period, period);
  float sawValue = sawPhase < (period * 0.5)
    ? (sawPhase / (period * 0.5)) * u_amplitude
    : ((period - sawPhase) / (period * 0.5)) * u_amplitude;

  float zigzagCentre = floor(perpDist / u_lineSpacing + 0.5) * u_lineSpacing;
  float dist = abs(perpDist - zigzagCentre + sawValue - u_amplitude * 0.5);

  float thickness = darkness * u_lineSpacing * 0.8;
  bool isInk = dist < thickness * 0.5;

  float v = isInk ? 0.0 : 1.0;
  fragColor = vec4(v, v, v, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_lineSpacing", "u_amplitude", "u_cosA", "u_sinA",
  ] as const) };
  return _cache;
};

export const zigzagGLAvailable = (): boolean => glAvailable();

export const renderZigzagGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  lineSpacing: number, amplitude: number, angleRad: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "zigzag:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_lineSpacing, lineSpacing);
    gl.uniform1f(cache.prog.uniforms.u_amplitude, amplitude);
    gl.uniform1f(cache.prog.uniforms.u_cosA, Math.cos(angleRad));
    gl.uniform1f(cache.prog.uniforms.u_sinA, Math.sin(angleRad));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
