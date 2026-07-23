import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Print duotone: two inks, each with its OWN tone-reproduction (density) curve,
// composited subtractively over paper like a duplex print. The shadow ink runs a
// monotonic shadow-weighted curve; the second ink runs a midtone density bump.
// The two curves overlap through the midtones, so both inks overprint there and
// produce the characteristic hue crossover a straight luma lerp cannot.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec3  u_shadowInk;
uniform vec3  u_highlightInk;
uniform vec3  u_paper;
uniform float u_shadowCurve;
uniform float u_highlightCurve;

void main() {
  vec4 c = texture(u_source, v_uv);
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float density = 1.0 - lum;
  // Shadow ink density: full in the deep tones, clearing to paper in highlights.
  float dShadow = clamp(pow(density, max(0.25, u_shadowCurve)), 0.0, 1.0);
  // Second ink density: a midtone bump that clears at both black and white, so it
  // overprints the shadow ink through the midtones instead of tracking it linearly.
  float bump = 4.0 * lum * (1.0 - lum);
  float dHighlight = clamp(0.72 * pow(bump, max(0.25, u_highlightCurve)), 0.0, 1.0);
  // Subtractive composite over paper, density-ordered like a duplex print:
  // paper base -> second ink -> shadow ink on top.
  vec3 outRgb = mix(u_paper, u_highlightInk, dHighlight);
  outRgb = mix(outRgb, u_shadowInk, dShadow);
  fragColor = vec4(clamp(outRgb, 0.0, 1.0), c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_shadowInk", "u_highlightInk", "u_paper", "u_shadowCurve", "u_highlightCurve",
  ] as const) };
  return _cache;
};

export const duotoneGLAvailable = (): boolean => glAvailable();

export const renderDuotoneGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  shadow: [number, number, number],
  highlight: [number, number, number],
  paper: [number, number, number],
  shadowCurve: number,
  highlightCurve: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "duotone:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform3f(cache.prog.uniforms.u_shadowInk, shadow[0] / 255, shadow[1] / 255, shadow[2] / 255);
    gl.uniform3f(cache.prog.uniforms.u_highlightInk, highlight[0] / 255, highlight[1] / 255, highlight[2] / 255);
    gl.uniform3f(cache.prog.uniforms.u_paper, paper[0] / 255, paper[1] / 255, paper[2] / 255);
    gl.uniform1f(cache.prog.uniforms.u_shadowCurve, shadowCurve);
    gl.uniform1f(cache.prog.uniforms.u_highlightCurve, highlightCurve);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
