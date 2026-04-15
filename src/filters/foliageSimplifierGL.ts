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

// Pass 1: horizontal box blur of the source (all 4 channels).
const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  vec2 px = v_uv * u_res;
  float y = floor(px.y);
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -12; k <= 12; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    acc += texture(u_input, (vec2(nx, y) + 0.5) / u_res);
    cnt += 1.0;
  }
  fragColor = acc / cnt;
}
`;

// Pass 2: vertical box blur of temp → blurred RGBA.
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
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -12; k <= 12; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(floor(px.y) + float(k), 0.0, u_res.y - 1.0);
    acc += texture(u_input, (vec2(x, ny) + 0.5) / u_res);
    cnt += 1.0;
  }
  fragColor = acc / cnt;
}
`;

// Final pass: per-pixel foliage mask (saturation × green/warm-leaf dominance),
// blended with the separably-blurred target, scaled by edge preservation and
// shadow retention. Optional brush-style quantisation of the blur target.
const FOLIAGE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform vec2  u_res;
uniform float u_regionMerge;
uniform float u_edgePreserve;
uniform float u_brushiness;
uniform float u_shadowRetention;
uniform float u_step;          // quantisation step for brushiness
uniform float u_levels;

vec2 jsUV(float x, float y_js) {
  return vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 src = texture(u_source, jsUV(x, y));
  vec4 blurred = texture(u_blurred, jsUV(x, y));
  vec3 s255 = src.rgb * 255.0;
  vec3 b255 = blurred.rgb * 255.0;

  float mx = max(max(s255.r, s255.g), s255.b);
  float mn = min(min(s255.r, s255.g), s255.b);
  float saturation = mx == 0.0 ? 0.0 : (mx - mn) / mx;
  float greenDom = clamp((s255.g - max(s255.r * 0.82, s255.b * 0.9)) / 90.0, 0.0, 1.0);
  float warmDom  = clamp((min(s255.r, s255.g) - s255.b) / 110.0, 0.0, 1.0);
  float foliage = clamp(saturation * max(greenDom, warmDom * 0.65) * 1.35, 0.0, 1.0);

  float edge = (abs(s255.r - b255.r) + abs(s255.g - b255.g) + abs(s255.b - b255.b)) / (255.0 * 3.0);
  float preserve = 1.0 - edge * u_edgePreserve;
  float luma = (0.2126 * s255.r + 0.7152 * s255.g + 0.0722 * s255.b) / 255.0;
  float shadowHold = mix(1.0 - u_shadowRetention * 0.65, 1.0, pow(luma, 0.8));
  float blend = clamp(foliage * u_regionMerge * preserve * shadowHold, 0.0, 1.0);

  vec3 target = b255;
  if (u_brushiness > 0.0) {
    target = floor(target / u_step + 0.5) * u_step;
  }

  vec3 finalRgb = clamp(floor(mix(s255, target, blend) + 0.5), 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    finalRgb = floor(finalRgb * q + 0.5) / q;
  }
  fragColor = vec4(finalRgb, src.a);
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
    blurH: linkProgram(gl, BLUR_H_FS, ["u_input", "u_res", "u_radius"] as const),
    blurV: linkProgram(gl, BLUR_V_FS, ["u_input", "u_res", "u_radius"] as const),
    final: linkProgram(gl, FOLIAGE_FS, [
      "u_source", "u_blurred", "u_res", "u_regionMerge", "u_edgePreserve",
      "u_brushiness", "u_shadowRetention", "u_step", "u_levels",
    ] as const),
  };
  return _cache;
};

export const foliageSimplifierGLAvailable = (): boolean => glAvailable();

export const renderFoliageSimplifierGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  radius: number,
  regionMerge: number,
  edgePreserve: number,
  brushiness: number,
  shadowRetention: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const step = Math.max(8, Math.round(64 - brushiness * 40));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "foliage:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const temp1 = ensureTexture(gl, "foliage:blurH", width, height);
  const temp2 = ensureTexture(gl, "foliage:blurHV", width, height);

  drawPass(gl, temp1, width, height, cache.blurH, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.blurH.uniforms.u_input, 0);
    gl.uniform2f(cache.blurH.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurH.uniforms.u_radius, radius);
  }, vao);

  drawPass(gl, temp2, width, height, cache.blurV, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp1.tex);
    gl.uniform1i(cache.blurV.uniforms.u_input, 0);
    gl.uniform2f(cache.blurV.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurV.uniforms.u_radius, radius);
  }, vao);

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.final.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, temp2.tex);
    gl.uniform1i(cache.final.uniforms.u_blurred, 1);
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform1f(cache.final.uniforms.u_regionMerge, regionMerge);
    gl.uniform1f(cache.final.uniforms.u_edgePreserve, edgePreserve);
    gl.uniform1f(cache.final.uniforms.u_brushiness, brushiness);
    gl.uniform1f(cache.final.uniforms.u_shadowRetention, shadowRetention);
    gl.uniform1f(cache.final.uniforms.u_step, step);
    gl.uniform1f(cache.final.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
