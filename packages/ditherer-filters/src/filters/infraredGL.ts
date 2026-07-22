import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// RGB sources contain no actual near-infrared band. Estimate one from visible
// material-color cues, then reproduce the film's NIR→R, R→G, G→B ordering.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_intensity;
uniform float u_falseColor;
uniform float u_foliageResponse;
uniform float u_skySuppression;
uniform float u_contrast;
uniform float u_grain;

vec3 srgbToLinear(vec3 encoded) {
  vec3 low = encoded / 12.92;
  vec3 high = pow((encoded + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), encoded));
}

vec3 linearToSrgb(vec3 linear) {
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linear));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = srgbToLinear(c.rgb);
  float luma = dot(src, vec3(0.2126, 0.7152, 0.0722));
  float greenExcess = max(0.0, src.g - (src.r + src.b) * 0.5);
  float skyLikelihood = smoothstep(0.02, 0.3, src.b - max(src.r, src.g));
  float estimatedNir = clamp(
    luma * 0.35 + src.r * 0.25 + src.g * 0.15
      + greenExcess * 1.4 * max(0.0, u_foliageResponse),
    0.0, 1.0
  );
  estimatedNir *= 1.0 - skyLikelihood * clamp(u_skySuppression, 0.0, 1.0);

  vec3 monochrome = vec3(estimatedNir);
  vec3 colorInfrared = vec3(estimatedNir, src.r, src.g);
  vec3 film = mix(monochrome, colorInfrared, clamp(u_falseColor, 0.0, 1.0));
  film = clamp((film - vec3(0.5)) * u_contrast + vec3(0.5), 0.0, 1.0);

  vec2 pixel = floor(v_uv * u_res);
  float densityGrain = (hash12(pixel) + hash12(pixel * 1.731 + 19.17) - 1.0) * u_grain;
  film = clamp(film + vec3(densityGrain), 0.0, 1.0);
  vec3 blended = mix(src, film, clamp(u_intensity, 0.0, 1.0));
  fragColor = vec4(clamp(linearToSrgb(blended), 0.0, 1.0), c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_intensity", "u_falseColor", "u_foliageResponse",
    "u_skySuppression", "u_contrast", "u_grain",
  ] as const) };
  return _cache;
};

export const infraredGLAvailable = (): boolean => glAvailable();

export const renderInfraredGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  intensity: number,
  falseColor: number,
  foliageResponse: number,
  skySuppression: number,
  contrast: number,
  grain: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "infrared:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
    gl.uniform1f(cache.prog.uniforms.u_falseColor, falseColor);
    gl.uniform1f(cache.prog.uniforms.u_foliageResponse, foliageResponse);
    gl.uniform1f(cache.prog.uniforms.u_skySuppression, skySuppression);
    gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
    gl.uniform1f(cache.prog.uniforms.u_grain, grain);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
