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

// Pass 1: compute luminance inline from the source, box-blur horizontally,
// and store in the R channel of temp1.
const BLUR_H_LUM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  float sum = 0.0;
  float cnt = 0.0;
  vec2 px = v_uv * u_res;
  float y = floor(px.y);
  for (int k = -20; k <= 20; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    vec3 c = texture(u_source, (vec2(nx, y) + 0.5) / u_res).rgb;
    sum += 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    cnt += 1.0;
  }
  fragColor = vec4(sum / cnt, 0.0, 0.0, 1.0);
}
`;

// Pass 2: vertical box-blur of temp1.R → temp2.R.
const BLUR_V_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  float sum = 0.0;
  float cnt = 0.0;
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  for (int k = -20; k <= 20; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(floor(px.y) + float(k), 0.0, u_res.y - 1.0);
    sum += texture(u_input, (vec2(x, ny) + 0.5) / u_res).r;
    cnt += 1.0;
  }
  fragColor = vec4(sum / cnt, 0.0, 0.0, 1.0);
}
`;

// Pass 3: central-difference gradient of the blurred luminance, project onto
// direction, sample source at displaced position. UNPACK_FLIP_Y=true means
// GL-y is inverted JS-y — we operate in JS-y pixel space throughout and map
// back to UV at sample time.
const LIQUIFY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform vec2  u_res;
uniform float u_strength;
uniform float u_cosD;
uniform float u_sinD;
uniform float u_levels;

vec2 jsUV(vec2 p) {
  return vec2((p.x + 0.5) / u_res.x, 1.0 - (p.y + 0.5) / u_res.y);
}
float readB(float x, float y) {
  return texture(u_blurred, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).r;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float lL = readB(max(0.0, x - 1.0), y);
  float lR = readB(min(u_res.x - 1.0, x + 1.0), y);
  float lT = readB(x, max(0.0, y - 1.0));
  float lB = readB(x, min(u_res.y - 1.0, y + 1.0));
  float gx = (lR - lL) * 0.5;
  float gy = (lB - lT) * 0.5;

  float proj = gx * u_cosD + gy * u_sinD;
  float dispX = proj * u_strength * u_cosD;
  float dispY = proj * u_strength * u_sinD;

  float sx = clamp(x - dispX, 0.0, u_res.x - 1.0);
  float sy = clamp(y - dispY, 0.0, u_res.y - 1.0);

  vec4 sampled = texture(u_source, jsUV(vec2(sx, sy)));
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
  finalProg: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blurH: linkProgram(gl, BLUR_H_LUM_FS, ["u_source", "u_res", "u_radius"] as const),
    blurV: linkProgram(gl, BLUR_V_FS, ["u_input", "u_res", "u_radius"] as const),
    finalProg: linkProgram(gl, LIQUIFY_FS, [
      "u_source", "u_blurred", "u_res", "u_strength", "u_cosD", "u_sinD", "u_levels",
    ] as const),
  };
  return _cache;
};

export const liquifyGLAvailable = (): boolean => glAvailable();

export const renderLiquifyGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  strength: number,
  smoothness: number,
  direction: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const radius = Math.max(1, Math.min(20, Math.round(smoothness)));
  const rad = (direction * Math.PI) / 180;
  const cosD = Math.cos(rad);
  const sinD = Math.sin(rad);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "liquify:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const temp1 = ensureTexture(gl, "liquify:temp1", width, height);
  const temp2 = ensureTexture(gl, "liquify:temp2", width, height);

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

  drawPass(gl, null, width, height, cache.finalProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.finalProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, temp2.tex);
    gl.uniform1i(cache.finalProg.uniforms.u_blurred, 1);
    gl.uniform2f(cache.finalProg.uniforms.u_res, width, height);
    gl.uniform1f(cache.finalProg.uniforms.u_strength, strength);
    gl.uniform1f(cache.finalProg.uniforms.u_cosD, cosD);
    gl.uniform1f(cache.finalProg.uniforms.u_sinD, sinD);
    gl.uniform1f(cache.finalProg.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
