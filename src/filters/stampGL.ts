import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Rubber-stamp binarisation: per-pixel luma threshold with three
// hash-noise perturbations (jitter, edge bias, ink fade). The JS hash
// is `fract(sin(x*127.1 + y*311.7) * 43758.5453)` — we reproduce it
// verbatim in GL so stamp positions match the reference exactly.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;
uniform float u_roughness;
uniform vec3  u_inkColor;    // 0..255
uniform vec3  u_paperColor;  // 0..255

float hashNoise(float x, float y) {
  float n = sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return fract(n);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb * 255.0;
  float lum = src.r * 0.2126 + src.g * 0.7152 + src.b * 0.0722;

  float jitter = (hashNoise(jsX, jsY) - 0.5) * u_roughness * 80.0;
  float edgeBias = (hashNoise(jsX * 0.5 + 19.0, jsY * 0.5 + 7.0) - 0.5) * u_roughness * 40.0;
  bool inked = (lum + jitter) < (u_threshold + edgeBias);
  float noiseFade = inked
    ? 1.0 - hashNoise(jsX * 1.7 + 3.0, jsY * 1.7 + 11.0) * u_roughness * 0.35
    : 1.0;
  vec3 src2 = inked ? u_inkColor : u_paperColor;

  vec3 outRgb = floor(src2 * noiseFade + u_paperColor * (1.0 - noiseFade) + 0.5);
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_threshold", "u_roughness",
    "u_inkColor", "u_paperColor",
  ] as const) };
  return _cache;
};

export const stampGLAvailable = (): boolean => glAvailable();

export const renderStampGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  threshold: number, roughness: number,
  inkColor: [number, number, number], paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "stamp:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_threshold, threshold);
    gl.uniform1f(cache.prog.uniforms.u_roughness, roughness);
    gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
