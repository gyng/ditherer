import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Threshold matte with feathered edge via smoothstep. Three background
// modes share the same core: transparent writes the mask into alpha;
// black/white blend the source against a flat fill.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_low;       // 0..255
uniform float u_high;      // 0..255
uniform int   u_invert;    // 1 = invert
uniform int   u_bgMode;    // 0 = transparent, 1 = black, 2 = white

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;
  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float mask;
  if (u_low == u_high) {
    mask = lum < u_low ? 0.0 : 1.0;
  } else {
    float t = clamp((lum - u_low) / (u_high - u_low), 0.0, 1.0);
    mask = t * t * (3.0 - 2.0 * t);
  }
  if (u_invert == 1) mask = 1.0 - mask;

  if (u_bgMode == 0) {
    float a = floor(mask * 255.0 + 0.5) / 255.0;
    fragColor = vec4(c.rgb, a);
  } else {
    float bg = u_bgMode == 2 ? 1.0 : 0.0;
    vec3 out3 = floor(src * mask + bg * 255.0 * (1.0 - mask) + 0.5) / 255.0;
    fragColor = vec4(out3, 1.0);
  }
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_low", "u_high", "u_invert", "u_bgMode",
  ] as const) };
  return _cache;
};

export const lumaMatteGLAvailable = (): boolean => glAvailable();

export const renderLumaMatteGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  low: number, high: number, invert: boolean, bgMode: 0 | 1 | 2,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lumaMatte:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_low, low);
    gl.uniform1f(cache.prog.uniforms.u_high, high);
    gl.uniform1i(cache.prog.uniforms.u_invert, invert ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_bgMode, bgMode);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
