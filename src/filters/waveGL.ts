import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Sinusoidal displacement: X offset driven by Y coord, Y offset by X
// coord, or both by (X+Y) for a diagonal wobble. Nearest-neighbour
// source sample with clamped integer offsets matches the JS reference.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_amplitudeX;
uniform float u_frequencyX;
uniform float u_amplitudeY;
uniform float u_frequencyY;
uniform float u_phaseX;
uniform float u_phaseY;
uniform int   u_diagonal;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float drivingX = u_diagonal == 1 ? (jsX + jsY) : jsY;
  float drivingY = u_diagonal == 1 ? (jsX + jsY) : jsX;
  float offsetX = floor(sin(drivingX * u_frequencyX + u_phaseX) * u_amplitudeX + 0.5);
  float offsetY = floor(sin(drivingY * u_frequencyY + u_phaseY) * u_amplitudeY + 0.5);

  float srcX = clamp(jsX + offsetX, 0.0, u_res.x - 1.0);
  float srcY = clamp(jsY + offsetY, 0.0, u_res.y - 1.0);

  vec2 sampleUV = vec2((srcX + 0.5) / u_res.x, 1.0 - (srcY + 0.5) / u_res.y);
  fragColor = texture(u_source, sampleUV);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res",
    "u_amplitudeX", "u_frequencyX", "u_amplitudeY", "u_frequencyY",
    "u_phaseX", "u_phaseY", "u_diagonal",
  ] as const) };
  return _cache;
};

export const waveGLAvailable = (): boolean => glAvailable();

export const renderWaveGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  amplitudeX: number, frequencyX: number,
  amplitudeY: number, frequencyY: number,
  phaseX: number, phaseY: number,
  diagonal: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "wave:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_amplitudeX, amplitudeX);
    gl.uniform1f(cache.prog.uniforms.u_frequencyX, frequencyX);
    gl.uniform1f(cache.prog.uniforms.u_amplitudeY, amplitudeY);
    gl.uniform1f(cache.prog.uniforms.u_frequencyY, frequencyY);
    gl.uniform1f(cache.prog.uniforms.u_phaseX, phaseX);
    gl.uniform1f(cache.prog.uniforms.u_phaseY, phaseY);
    gl.uniform1i(cache.prog.uniforms.u_diagonal, diagonal ? 1 : 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
