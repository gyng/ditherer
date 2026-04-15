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

// Pass 1 (optional): horizontal box-blur of source luminance, output in R.
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
  for (int k = -50; k <= 50; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    vec3 c = texture(u_source, (vec2(nx, y) + 0.5) / u_res).rgb;
    sum += 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    cnt += 1.0;
  }
  fragColor = vec4(sum / cnt, 0.0, 0.0, 1.0);
}
`;

// Pass 2 (optional): vertical box-blur of temp.R → R.
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
  for (int k = -50; k <= 50; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(floor(px.y) + float(k), 0.0, u_res.y - 1.0);
    sum += texture(u_input, (vec2(x, ny) + 0.5) / u_res).r;
    cnt += 1.0;
  }
  fragColor = vec4(sum / cnt, 0.0, 0.0, 1.0);
}
`;

// Final pass: sample warp luminance (either source directly or the blurred
// temp), compute displacement (warp - 0.5) * strength, apply to x/y/both, then
// sample source at the displaced pixel. Optional nearest-palette quantise.
const DISPLACE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_warp;    // R channel = warp luminance; when u_useBlurred=0 we ignore and compute from source
uniform int   u_useBlurred;
uniform vec2  u_res;
uniform float u_strength;
uniform int   u_direction;   // 0 X, 1 Y, 2 BOTH
uniform float u_levels;

vec2 jsUV(float x, float y_js) {
  return vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y);
}

float warpAt(float x, float y_js) {
  if (u_useBlurred == 1) {
    return texture(u_warp, jsUV(x, y_js)).r;
  }
  vec3 c = texture(u_source, jsUV(x, y_js)).rgb;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_js = u_res.y - 1.0 - floor(px.y);

  float disp = (warpAt(x, y_js) - 0.5) * u_strength;

  float sx = u_direction == 1 ? x : clamp(floor(x + disp + 0.5), 0.0, u_res.x - 1.0);
  float sy = u_direction == 0 ? y_js : clamp(floor(y_js + disp + 0.5), 0.0, u_res.y - 1.0);

  vec4 sampled = texture(u_source, jsUV(sx, sy));
  vec3 rgb = sampled.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, sampled.a);
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
    final: linkProgram(gl, DISPLACE_FS, [
      "u_source", "u_warp", "u_useBlurred", "u_res", "u_strength", "u_direction", "u_levels",
    ] as const),
  };
  return _cache;
};

export const displaceGLAvailable = (): boolean => glAvailable();

export const DISPLACE_DIR_ID: Record<string, number> = { X: 0, Y: 1, BOTH: 2 };

export const renderDisplaceGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  strength: number,
  direction: string,
  warpSource: string,
  blurRadius: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const dirId = DISPLACE_DIR_ID[direction];
  if (dirId === undefined) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const useBlurred = warpSource === "BLURRED";
  const radius = Math.max(1, Math.min(50, Math.round(blurRadius)));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "displace:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  let warpTex = sourceTex;
  if (useBlurred) {
    const temp1 = ensureTexture(gl, "displace:lumH", width, height);
    const temp2 = ensureTexture(gl, "displace:lumHV", width, height);
    drawPass(gl, temp1, width, height, cache.blurH, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.blurH.uniforms.u_source, 0);
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
    warpTex = temp2;
  }

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.final.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, warpTex.tex);
    gl.uniform1i(cache.final.uniforms.u_warp, 1);
    gl.uniform1i(cache.final.uniforms.u_useBlurred, useBlurred ? 1 : 0);
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform1f(cache.final.uniforms.u_strength, strength);
    gl.uniform1i(cache.final.uniforms.u_direction, dirId);
    gl.uniform1f(cache.final.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
