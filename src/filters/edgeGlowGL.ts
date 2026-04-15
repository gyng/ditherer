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
} from "gl";

// Pass 1: compute luminance inline, run a 3×3 Sobel, threshold, store
// min(1, magnitude/255) in the R channel (0 on image borders, matching JS).
const EDGE_DETECT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;

float lumAt(float x, float y) {
  x = clamp(x, 0.0, u_res.x - 1.0);
  y = clamp(y, 0.0, u_res.y - 1.0);
  vec3 c = texture(u_source, (vec2(x, y) + 0.5) / u_res).rgb * 255.0;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);

  // Border pixels stay at 0 (JS only computes y=1..H-2, x=1..W-2).
  if (x < 1.0 || y < 1.0 || x > u_res.x - 2.0 || y > u_res.y - 2.0) {
    fragColor = vec4(0.0);
    return;
  }

  float tl = lumAt(x - 1.0, y - 1.0);
  float tc = lumAt(x,        y - 1.0);
  float tr = lumAt(x + 1.0,  y - 1.0);
  float ml = lumAt(x - 1.0,  y);
  float mr = lumAt(x + 1.0,  y);
  float bl = lumAt(x - 1.0,  y + 1.0);
  float bc = lumAt(x,        y + 1.0);
  float br = lumAt(x + 1.0,  y + 1.0);
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float mag = sqrt(gx * gx + gy * gy);

  float edge = mag > u_threshold ? min(1.0, mag / 255.0) : 0.0;
  fragColor = vec4(edge, 0.0, 0.0, 1.0);
}
`;

// Pass 2: separable Gaussian (horizontal) of the edge map. Stores in R.
const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_sigma;

void main() {
  float sum = 0.0;
  float wsum = 0.0;
  float tss = 2.0 * u_sigma * u_sigma;
  vec2 px = v_uv * u_res;
  float y = floor(px.y);
  for (int k = -16; k <= 16; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / tss);
    float nx = clamp(floor(px.x) + fk, 0.0, u_res.x - 1.0);
    sum += texture(u_input, (vec2(nx, y) + 0.5) / u_res).r * w;
    wsum += w;
  }
  fragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`;

// Pass 3: vertical Gaussian of the H-blurred map, max-merged with the
// pre-blur edge map, then composited between background and edge colours
// with optional nearest-palette quantisation.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_edgeOrig;  // pass 1 result
uniform sampler2D u_edgeBlurH; // pass 2 result (H-blurred)
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_sigma;
uniform vec3  u_bg;            // 0..255
uniform vec3  u_edge;          // 0..255
uniform float u_levels;

void main() {
  float sum = 0.0;
  float wsum = 0.0;
  float tss = 2.0 * u_sigma * u_sigma;
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  for (int k = -16; k <= 16; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / tss);
    float ny = clamp(floor(px.y) + fk, 0.0, u_res.y - 1.0);
    sum += texture(u_edgeBlurH, (vec2(x, ny) + 0.5) / u_res).r * w;
    wsum += w;
  }
  float vblur = u_radius > 0 ? sum / wsum : 0.0;
  float orig = texture(u_edgeOrig, (vec2(x, floor(px.y)) + 0.5) / u_res).r;
  float t = min(1.0, max(orig, u_radius > 0 ? vblur : orig));

  vec3 c = u_bg + (u_edge - u_bg) * t;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    c = floor(c / 255.0 * q + 0.5) / q * 255.0;
  }
  fragColor = vec4(c / 255.0, 1.0);
}
`;

type Cache = {
  detect: Program;
  blurH: Program;
  final: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    detect: linkProgram(gl, EDGE_DETECT_FS, ["u_source", "u_res", "u_threshold"] as const),
    blurH: linkProgram(gl, BLUR_H_FS, ["u_input", "u_res", "u_radius", "u_sigma"] as const),
    final: linkProgram(gl, FINAL_FS, [
      "u_edgeOrig", "u_edgeBlurH", "u_res", "u_radius", "u_sigma", "u_bg", "u_edge", "u_levels",
    ] as const),
  };
  return _cache;
};

export const edgeGlowGLAvailable = (): boolean => glAvailable();

export const renderEdgeGlowGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  threshold: number,
  glowRadius: number,
  edgeColor: [number, number, number],
  backgroundColor: [number, number, number],
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const sigma = Math.max(0.0001, glowRadius);
  const radius = glowRadius > 0 ? Math.min(16, Math.ceil(sigma * 2)) : 0;

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "edgeGlow:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const edgeTex = ensureTexture(gl, "edgeGlow:edge", width, height);
  const edgeHTex = ensureTexture(gl, "edgeGlow:edgeH", width, height);

  drawPass(gl, edgeTex, width, height, cache.detect, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.detect.uniforms.u_source, 0);
    gl.uniform2f(cache.detect.uniforms.u_res, width, height);
    gl.uniform1f(cache.detect.uniforms.u_threshold, threshold);
  }, vao);

  if (radius > 0) {
    drawPass(gl, edgeHTex, width, height, cache.blurH, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, edgeTex.tex);
      gl.uniform1i(cache.blurH.uniforms.u_input, 0);
      gl.uniform2f(cache.blurH.uniforms.u_res, width, height);
      gl.uniform1i(cache.blurH.uniforms.u_radius, radius);
      gl.uniform1f(cache.blurH.uniforms.u_sigma, sigma);
    }, vao);
  }

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, edgeTex.tex);
    gl.uniform1i(cache.final.uniforms.u_edgeOrig, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (radius > 0 ? edgeHTex : edgeTex).tex);
    gl.uniform1i(cache.final.uniforms.u_edgeBlurH, 1);
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform1i(cache.final.uniforms.u_radius, radius);
    gl.uniform1f(cache.final.uniforms.u_sigma, sigma);
    gl.uniform3f(cache.final.uniforms.u_bg, backgroundColor[0], backgroundColor[1], backgroundColor[2]);
    gl.uniform3f(cache.final.uniforms.u_edge, edgeColor[0], edgeColor[1], edgeColor[2]);
    gl.uniform1f(cache.final.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
