import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-pixel sky detection + gradient + procedural clouds. Detection
// leans on: (a) vertical region mask (top of frame down to skyStart),
// (b) blue bias + brightness + desaturation. Cloud mode layers a
// smoothed multi-sine mask over the gradient.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;         // 0 = gradient, 1 = gradient + clouds
uniform float u_skyStart;
uniform vec3  u_gradientTop;
uniform vec3  u_gradientBottom;
uniform float u_cloudAmount;
uniform float u_cloudSoftness;
uniform float u_blend;

float ss(float a, float b, float v) {
  float t = clamp((v - a) / max(1e-6, b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float pseudoCloud(float xNorm, float yNorm) {
  float a = sin(xNorm * 8.4 + yNorm * 6.2);
  float b = sin(xNorm * 17.1 - yNorm * 11.6);
  float c = sin((xNorm + yNorm * 0.75) * 29.3);
  float v = (a * 0.45 + b * 0.35 + c * 0.2 + 1.0) * 0.5;
  return ss(0.55 - u_cloudSoftness * 0.25, 0.82 + u_cloudSoftness * 0.15, v);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 c = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));
  vec3 src = c.rgb * 255.0;

  float yNorm = u_res.y <= 1.0 ? 0.0 : jsY / (u_res.y - 1.0);
  float regionMask = 1.0 - ss(max(0.02, u_skyStart - 0.12), u_skyStart + 0.03, yNorm);
  float skyT = clamp(yNorm / max(0.001, u_skyStart), 0.0, 1.0);

  float maxCh = max(src.r, max(src.g, src.b));
  float minCh = min(src.r, min(src.g, src.b));
  float saturation = maxCh == 0.0 ? 0.0 : (maxCh - minCh) / maxCh;
  float brightness = maxCh / 255.0;
  float blueBias = clamp((src.b - max(src.r, src.g) * 0.8) / 80.0, 0.0, 1.0);
  float candidateMask = clamp(blueBias * 0.65 + brightness * 0.25 + (1.0 - saturation) * 0.1, 0.0, 1.0);
  float skyMask = regionMask * candidateMask * u_blend;

  float skyPow = pow(skyT, 0.9);
  vec3 target = mix(u_gradientTop, u_gradientBottom, skyPow);

  if (u_mode == 1 && u_cloudAmount > 0.0) {
    float xNorm = u_res.x <= 1.0 ? 0.0 : jsX / (u_res.x - 1.0);
    float cloudMask = pseudoCloud(xNorm, yNorm) * u_cloudAmount * regionMask;
    target.r = mix(target.r, 255.0, cloudMask * 0.9);
    target.g = mix(target.g, 252.0, cloudMask * 0.92);
    target.b = mix(target.b, 248.0, cloudMask * 0.95);
  }

  vec3 finalRgb = clamp(floor(mix(src, target, skyMask) + 0.5), 0.0, 255.0);
  fragColor = vec4(finalRgb / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_mode", "u_skyStart",
    "u_gradientTop", "u_gradientBottom",
    "u_cloudAmount", "u_cloudSoftness", "u_blend",
  ] as const) };
  return _cache;
};

export const animeSkyGLAvailable = (): boolean => glAvailable();

export const renderAnimeSkyGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  modeIsClouds: boolean, skyStart: number,
  gradientTop: [number, number, number],
  gradientBottom: [number, number, number],
  cloudAmount: number, cloudSoftness: number, blend: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "animeSky:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_mode, modeIsClouds ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_skyStart, skyStart);
    gl.uniform3f(cache.prog.uniforms.u_gradientTop, gradientTop[0], gradientTop[1], gradientTop[2]);
    gl.uniform3f(cache.prog.uniforms.u_gradientBottom, gradientBottom[0], gradientBottom[1], gradientBottom[2]);
    gl.uniform1f(cache.prog.uniforms.u_cloudAmount, cloudAmount);
    gl.uniform1f(cache.prog.uniforms.u_cloudSoftness, cloudSoftness);
    gl.uniform1f(cache.prog.uniforms.u_blend, blend);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
