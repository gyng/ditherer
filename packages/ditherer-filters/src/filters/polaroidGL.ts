import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

// Instant-film-inspired dye balance, shadow lift, fixed grain, and optical
// vignetting. Neutral settings are an identity transform: the simulation does
// not impose undocumented blur or highlight clipping.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_warmth;
uniform float u_fadedBlacks;
uniform float u_saturation;
uniform float u_grain;
uniform float u_vignette;

float mulberryFirst(int seed) {
  uint s = uint(seed) + 0x6D2B79F5u;
  uint t = (s ^ (s >> 15u)) * (1u | s);
  t = ((t ^ (t >> 7u)) * (61u | t)) ^ t;
  t = t ^ (t >> 14u);
  return float(t) / 4294967296.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  // Film chemistry does not impose an output-pixel-sized blur. Camera focus
  // and motion blur belong in optical effects, so retain source definition.
  vec3 rgb = texture(u_source, v_uv).rgb * 255.0;

  // Desaturate toward luma.
  float luma = rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
  rgb = vec3(luma) + (rgb - vec3(luma)) * u_saturation;

  // Lift shadows while keeping white fixed.
  rgb = rgb / 255.0;
  rgb += (u_fadedBlacks / 255.0) * (1.0 - rgb);

  // Warm dye balance with luminance compensation. Multiplicative balance
  // preserves black; compensation avoids an accidental exposure change.
  float beforeWarmth = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb *= vec3(1.0 + u_warmth * 0.12,
              1.0 + u_warmth * 0.035,
              1.0 - u_warmth * 0.12);
  float afterWarmth = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  if (afterWarmth > 1e-6) rgb *= beforeWarmth / afterWarmth;
  rgb *= 255.0;

  // Grain (per-pixel deterministic noise).
  if (u_grain > 0.0) {
    int seed = int(jsX) * 31 + int(jsY) * 997 + 42;
    float noise = (mulberryFirst(seed) - 0.5) * u_grain * 255.0;
    rgb += vec3(noise);
  }

  // Vignette.
  if (u_vignette > 0.0) {
    float cx = u_res.x * 0.5;
    float cy = u_res.y * 0.5;
    float dx = (jsX - cx) / cx;
    float dy = (jsY - cy) / cy;
    float dist = sqrt(dx * dx + dy * dy);
    float vig = 1.0 - u_vignette * dist * dist * 0.5;
    rgb *= vig;
  }

  rgb = clamp(floor(rgb + 0.5), 0.0, 255.0);
  fragColor = vec4(rgb / 255.0, texture(u_source, v_uv).a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source",
      "u_res",
      "u_warmth",
      "u_fadedBlacks",
      "u_saturation",
      "u_grain",
      "u_vignette",
    ] as const),
  };
  return _cache;
};

export const polaroidGLAvailable = (): boolean => glAvailable();

export const renderPolaroidGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  warmth: number,
  fadedBlacks: number,
  saturation: number,
  grain: number,
  vignette: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "polaroid:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(
    gl,
    null,
    width,
    height,
    cache.prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.prog.uniforms.u_source, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1f(cache.prog.uniforms.u_warmth, warmth);
      gl.uniform1f(cache.prog.uniforms.u_fadedBlacks, fadedBlacks);
      gl.uniform1f(cache.prog.uniforms.u_saturation, saturation);
      gl.uniform1f(cache.prog.uniforms.u_grain, grain);
      gl.uniform1f(cache.prog.uniforms.u_vignette, vignette);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
