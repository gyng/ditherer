import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Two-plate duplex print: luminance drives a dark plate and an accent
// plate over a paper stock colour. Matches the JS reference coefficients
// (0.9 for dark plate, 0.65 for accent) so tone curves stay identical.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec3  u_inkA;
uniform vec3  u_inkB;
uniform vec3  u_paper;
uniform float u_curve;

void main() {
  vec4 c = texture(u_source, v_uv);
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float darkPlate   = pow(1.0 - lum, u_curve);
  float accentPlate = pow(lum, 1.0 / max(0.001, u_curve));
  vec3 paperTerm  = u_paper * (1.0 - darkPlate * 0.9 - accentPlate * 0.65);
  vec3 darkTerm   = u_inkA  * darkPlate   * 0.9;
  vec3 accentTerm = u_inkB  * accentPlate * 0.65;
  vec3 outRgb = clamp(paperTerm + darkTerm + accentTerm, 0.0, 255.0);
  fragColor = vec4(floor(outRgb + 0.5) / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_inkA", "u_inkB", "u_paper", "u_curve"] as const) };
  return _cache;
};

export const duplexPrintGLAvailable = (): boolean => glAvailable();

export const renderDuplexPrintGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  inkA: [number, number, number],
  inkB: [number, number, number],
  paper: [number, number, number],
  mixCurve: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "duplexPrint:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform3f(cache.prog.uniforms.u_inkA, inkA[0], inkA[1], inkA[2]);
    gl.uniform3f(cache.prog.uniforms.u_inkB, inkB[0], inkB[1], inkB[2]);
    gl.uniform3f(cache.prog.uniforms.u_paper, paper[0], paper[1], paper[2]);
    gl.uniform1f(cache.prog.uniforms.u_curve, mixCurve);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
