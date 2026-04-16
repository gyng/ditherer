import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Cel-shaded tone banding: quantise luma to a stepped ramp (different
// step counts for shadows vs highlights), softstep back toward the raw
// luma near band edges, optionally de-band likely skin tones. The
// output keeps the source chroma by scaling RGB by (target / raw) luma.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_shadowSteps;
uniform float u_highlightSteps;
uniform float u_edgeSoftness;
uniform float u_bandBias;
uniform int   u_preserveSkin;
uniform float u_mix;

float ss(float e0, float e1, float v) {
  float t = clamp((v - e0) / max(1e-6, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float quantize(float v, float steps) {
  float c = max(2.0, floor(steps + 0.5));
  return floor(clamp(v, 0.0, 1.0) * (c - 1.0) + 0.5) / max(1.0, c - 1.0);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;

  float luma = (0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b) / 255.0;
  float biased = clamp(luma + u_bandBias * (0.5 - luma), 0.0, 1.0);
  float steps = biased < 0.5 ? u_shadowSteps : u_highlightSteps;
  float q = quantize(biased, steps);
  float softMix = u_edgeSoftness > 0.0
    ? ss(0.0, u_edgeSoftness, abs(biased - q))
    : 1.0;
  float targetLuma = mix(q, biased, softMix * 0.5);

  if (u_preserveSkin == 1) {
    bool skinish = src.r > src.g && src.g > src.b && (src.r - src.b) > 18.0 && (src.g - src.b) > 8.0;
    if (skinish) targetLuma = mix(targetLuma, luma, 0.45);
  }

  float scale = luma <= 0.001 ? targetLuma : targetLuma / luma;
  vec3 band = clamp(floor(src * scale + 0.5), 0.0, 255.0);
  vec3 final3 = clamp(floor(mix(src, band, u_mix) + 0.5), 0.0, 255.0);
  fragColor = vec4(final3 / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_shadowSteps", "u_highlightSteps", "u_edgeSoftness",
    "u_bandBias", "u_preserveSkin", "u_mix",
  ] as const) };
  return _cache;
};

export const animeToneBandsGLAvailable = (): boolean => glAvailable();

export const renderAnimeToneBandsGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  shadowSteps: number, highlightSteps: number,
  edgeSoftness: number, bandBias: number,
  preserveSkin: boolean, mix: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "animeToneBands:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_shadowSteps, shadowSteps);
    gl.uniform1f(cache.prog.uniforms.u_highlightSteps, highlightSteps);
    gl.uniform1f(cache.prog.uniforms.u_edgeSoftness, edgeSoftness);
    gl.uniform1f(cache.prog.uniforms.u_bandBias, bandBias);
    gl.uniform1i(cache.prog.uniforms.u_preserveSkin, preserveSkin ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_mix, mix);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
