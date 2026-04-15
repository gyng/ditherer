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

// Pass 1: horizontal box blur of source luminance. Stores in R channel.
const BLUR_H_LUM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  vec2 px = v_uv * u_res;
  float y = floor(px.y);
  float sum = 0.0;
  float cnt = 0.0;
  for (int k = -8; k <= 8; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    vec3 c = texture(u_source, (vec2(nx, y) + 0.5) / u_res).rgb;
    sum += 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    cnt += 1.0;
  }
  fragColor = vec4(sum / cnt, 0.0, 0.0, 1.0);
}
`;

// Pass 2: vertical box blur of temp.R → blurred luminance in R.
const BLUR_V_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float sum = 0.0;
  float cnt = 0.0;
  for (int k = -8; k <= 8; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(floor(px.y) + float(k), 0.0, u_res.y - 1.0);
    sum += texture(u_input, (vec2(x, ny) + 0.5) / u_res).r;
    cnt += 1.0;
  }
  fragColor = vec4(sum / cnt, 0.0, 0.0, 1.0);
}
`;

// Final pass: paper-white base, layer 1 (color1) where blurred-luminance at
// (x,y) < threshold, layer 2 (color2) where blurred-luminance at
// (x - misregX, y - misregY) >= threshold. Grain via hash noise per pixel.
const RISO_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_blurred;  // R = blurred luminance 0..255 divided-ish; actually 0..255 here
uniform vec2  u_res;
uniform vec3  u_color1;       // 0..255
uniform vec3  u_color2;       // 0..255
uniform int   u_misregX;
uniform int   u_misregY;
uniform float u_grain;
uniform float u_threshold;
uniform float u_frameSeed;
uniform float u_levels;

vec2 bUV(float x, float y_js) {
  return vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y);
}

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Paper-white base.
  vec3 rgb = vec3(245.0, 240.0, 235.0);

  // Layer 1 (color1): intensity = 1 - L/255 where L is blurred luminance at (x,y).
  float l1 = texture(u_blurred, bUV(x, y)).r * 255.0;
  if (l1 < u_threshold) {
    float darkness = 1.0 - l1 / 255.0;
    float n = u_grain > 0.0 ? (hash(vec2(x, y), u_frameSeed) - 0.5) * u_grain * 100.0 : 0.0;
    float intensity = clamp(darkness + n / 255.0, 0.0, 1.0);
    rgb = rgb * (1.0 - intensity) + u_color1 * intensity;
  }

  // Layer 2 (color2) at the misregistration-offset source position.
  float sx = clamp(x - float(u_misregX), 0.0, u_res.x - 1.0);
  float sy = clamp(y - float(u_misregY), 0.0, u_res.y - 1.0);
  float l2 = texture(u_blurred, bUV(sx, sy)).r * 255.0;
  if (l2 >= u_threshold) {
    float brightness = l2 / 255.0;
    // A second noise sample at the offset position to avoid correlating the
    // two layers' grain; seed-shifted so the hash distribution diverges.
    float n = u_grain > 0.0 ? (hash(vec2(x, y), u_frameSeed + 97.0) - 0.5) * u_grain * 100.0 : 0.0;
    float intensity = clamp(brightness + n / 255.0, 0.0, 1.0);
    rgb = rgb * (1.0 - intensity * 0.7) + u_color2 * intensity * 0.7;
  }

  vec3 out01 = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    out01 = floor(out01 * q + 0.5) / q;
  }
  fragColor = vec4(out01, 1.0);
}
`;

type Cache = {
  blurH: Program;
  blurV: Program;
  final: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blurH: linkProgram(gl, BLUR_H_LUM_FS, ["u_source", "u_res", "u_radius"] as const),
    blurV: linkProgram(gl, BLUR_V_FS, ["u_input", "u_res", "u_radius"] as const),
    final: linkProgram(gl, RISO_FS, [
      "u_blurred", "u_res", "u_color1", "u_color2", "u_misregX", "u_misregY",
      "u_grain", "u_threshold", "u_frameSeed", "u_levels",
    ] as const),
  };
  return _cache;
};

export const risographGLAvailable = (): boolean => glAvailable();

export const renderRisographGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: {
    color1: [number, number, number];
    color2: [number, number, number];
    misregX: number;
    misregY: number;
    grain: number;
    inkBleed: number;
    threshold: number;
    frameIndex: number;
    levels: number;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const blurR = Math.max(1, Math.min(8, Math.round(params.inkBleed * 3)));
  const frameSeed = params.frameIndex * 7919 + 31337;

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "risograph:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const temp1 = ensureTexture(gl, "risograph:lumH", width, height);
  const temp2 = ensureTexture(gl, "risograph:lumHV", width, height);

  drawPass(gl, temp1, width, height, cache.blurH, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.blurH.uniforms.u_source, 0);
    gl.uniform2f(cache.blurH.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurH.uniforms.u_radius, blurR);
  }, vao);

  drawPass(gl, temp2, width, height, cache.blurV, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp1.tex);
    gl.uniform1i(cache.blurV.uniforms.u_input, 0);
    gl.uniform2f(cache.blurV.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurV.uniforms.u_radius, blurR);
  }, vao);

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp2.tex);
    gl.uniform1i(cache.final.uniforms.u_blurred, 0);
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform3f(cache.final.uniforms.u_color1, params.color1[0], params.color1[1], params.color1[2]);
    gl.uniform3f(cache.final.uniforms.u_color2, params.color2[0], params.color2[1], params.color2[2]);
    gl.uniform1i(cache.final.uniforms.u_misregX, params.misregX);
    gl.uniform1i(cache.final.uniforms.u_misregY, params.misregY);
    gl.uniform1f(cache.final.uniforms.u_grain, params.grain);
    gl.uniform1f(cache.final.uniforms.u_threshold, params.threshold);
    gl.uniform1f(cache.final.uniforms.u_frameSeed, frameSeed);
    gl.uniform1f(cache.final.uniforms.u_levels, params.levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
