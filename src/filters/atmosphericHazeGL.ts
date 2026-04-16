import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Depth-cued haze with three depth modes (luma / vertical / hybrid),
// tint shift, and highlight bloom-to-white. JS-orientation y so the
// horizon offset aligns with the reference.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strength;
uniform float u_horizon;
uniform float u_softness;
uniform float u_highlightBloom;
uniform vec3  u_tint;       // 0..255
uniform int   u_depthMode;  // 0 hybrid, 1 vertical, 2 luma

float ss(float a, float b, float v) {
  float t = clamp((v - a) / max(1e-6, b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 c = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));
  vec3 src = c.rgb * 255.0;

  float yNorm = u_res.y <= 1.0 ? 0.0 : jsY / (u_res.y - 1.0);
  float verticalDepth = 1.0 - ss(u_horizon - u_softness, u_horizon + u_softness, yNorm);

  float luma = (0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b) / 255.0;
  float depth = u_depthMode == 1
    ? verticalDepth
    : u_depthMode == 2
      ? luma
      : verticalDepth * 0.65 + luma * 0.35;

  float haze = clamp(depth * u_strength, 0.0, 1.0);
  float bloom = u_highlightBloom * haze * ss(0.55, 1.0, luma);
  float tintMix = clamp(haze + bloom * 0.5, 0.0, 1.0);

  vec3 lifted = src + (u_tint - src) * tintMix;
  float whiteMix = bloom * 0.35;
  vec3 finalRgb = clamp(floor(lifted + (vec3(255.0) - lifted) * whiteMix + 0.5), 0.0, 255.0);
  fragColor = vec4(finalRgb / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_strength", "u_horizon", "u_softness",
    "u_highlightBloom", "u_tint", "u_depthMode",
  ] as const) };
  return _cache;
};

export const atmosphericHazeGLAvailable = (): boolean => glAvailable();

export const renderAtmosphericHazeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  strength: number, horizon: number, softness: number, highlightBloom: number,
  tint: [number, number, number], depthMode: 0 | 1 | 2,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "atmosphericHaze:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_strength, strength);
    gl.uniform1f(cache.prog.uniforms.u_horizon, horizon);
    gl.uniform1f(cache.prog.uniforms.u_softness, softness);
    gl.uniform1f(cache.prog.uniforms.u_highlightBloom, highlightBloom);
    gl.uniform3f(cache.prog.uniforms.u_tint, tint[0], tint[1], tint[2]);
    gl.uniform1i(cache.prog.uniforms.u_depthMode, depthMode);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
