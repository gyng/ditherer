import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Anime-style colour grade: levels tone remap → shadow-cool +
// highlight-warm tints → luma-preserving pull-back → vibrance boost.
// Pure per-pixel math, mirrors the JS reference.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_shadowCool;
uniform float u_highlightWarm;
uniform float u_blackPoint;
uniform float u_whitePoint;
uniform float u_contrast;
uniform float u_midtoneLift;
uniform float u_vibrance;
uniform float u_mix;

float ss(float a, float b, float v) {
  float t = clamp((v - a) / max(1e-6, b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float applyTone(float value) {
  float n = clamp((value - u_blackPoint) / max(1.0, u_whitePoint - u_blackPoint), 0.0, 1.0);
  if (u_contrast != 0.0) n = clamp(0.5 + (n - 0.5) * (1.0 + u_contrast), 0.0, 1.0);
  float gamma = clamp(1.0 - u_midtoneLift, 0.25, 3.0);
  n = pow(n, gamma);
  return clamp(floor(n * 255.0 + 0.5), 0.0, 255.0);
}

vec3 applyVibrance(vec3 rgb, float vib) {
  if (vib <= 0.0) return rgb;
  float average = (rgb.r + rgb.g + rgb.b) / 3.0;
  float maxCh = max(rgb.r, max(rgb.g, rgb.b));
  float minCh = min(rgb.r, min(rgb.g, rgb.b));
  float saturation = (maxCh - minCh) / 255.0;
  float boost = 1.0 + vib * (1.0 - saturation);
  return clamp(floor(vec3(average) + (rgb - vec3(average)) * boost + 0.5), 0.0, 255.0);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;

  vec3 base = vec3(applyTone(src.r), applyTone(src.g), applyTone(src.b));
  float toneLuma = (0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b) / 255.0;
  float shadowWeight = 1.0 - ss(0.24, 0.72, toneLuma);
  float highlightWeight = ss(0.34, 0.84, toneLuma);

  vec3 graded = vec3(
    base.r - shadowWeight * u_shadowCool * 28.0 + highlightWeight * u_highlightWarm * 36.0,
    base.g + shadowWeight * u_shadowCool * 16.0 + highlightWeight * u_highlightWarm * 12.0,
    base.b + shadowWeight * u_shadowCool * 44.0 - highlightWeight * u_highlightWarm * 16.0
  );

  float coolStrength = shadowWeight * u_shadowCool;
  float warmStrength = highlightWeight * u_highlightWarm;

  vec3 coolTint = vec3(
    base.r * (1.0 - 0.22 * coolStrength),
    base.g * (1.0 + 0.05 * coolStrength),
    base.b * (1.0 + 0.22 * coolStrength)
  );
  vec3 warmTint = vec3(
    base.r * (1.0 + 0.18 * warmStrength),
    base.g * (1.0 + 0.07 * warmStrength),
    base.b * (1.0 - 0.16 * warmStrength)
  );
  graded = mix(graded, coolTint, 0.65 * coolStrength);
  graded = mix(graded, warmTint, 0.75 * warmStrength);

  float baseLum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
  float gradedLum = 0.2126 * graded.r + 0.7152 * graded.g + 0.0722 * graded.b;
  float lumDelta = baseLum - gradedLum;
  float lumRestore = 0.45;
  graded = clamp(floor(mix(graded, graded + vec3(lumDelta), lumRestore) + 0.5), 0.0, 255.0);

  graded = applyVibrance(graded, u_vibrance);

  vec3 finalRgb = clamp(floor(base + (graded - base) * u_mix + 0.5), 0.0, 255.0);
  fragColor = vec4(finalRgb / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_shadowCool", "u_highlightWarm", "u_blackPoint",
    "u_whitePoint", "u_contrast", "u_midtoneLift", "u_vibrance", "u_mix",
  ] as const) };
  return _cache;
};

export const animeColorGradeGLAvailable = (): boolean => glAvailable();

export const renderAnimeColorGradeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  shadowCool: number, highlightWarm: number, blackPoint: number, whitePoint: number,
  contrast: number, midtoneLift: number, vibrance: number, mix: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "animeColorGrade:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_shadowCool, shadowCool);
    gl.uniform1f(cache.prog.uniforms.u_highlightWarm, highlightWarm);
    gl.uniform1f(cache.prog.uniforms.u_blackPoint, blackPoint);
    gl.uniform1f(cache.prog.uniforms.u_whitePoint, whitePoint);
    gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
    gl.uniform1f(cache.prog.uniforms.u_midtoneLift, midtoneLift);
    gl.uniform1f(cache.prog.uniforms.u_vibrance, vibrance);
    gl.uniform1f(cache.prog.uniforms.u_mix, mix);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
