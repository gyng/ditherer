import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const MAX_BLUR = 32;

// Separable gaussian — blurred copy drives the wash intensity so brushy
// regions read as continuous tone instead of noisy pixels.
const GAUSS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;
uniform float u_sigma;
uniform int   u_radius;
void main() {
  float twoSigmaSq = 2.0 * u_sigma * u_sigma + 1e-6;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = -${MAX_BLUR}; k <= ${MAX_BLUR}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / twoSigmaSq);
    vec2 uv = clamp(v_uv + u_dir * fk,
                    vec2(0.5) / u_res,
                    vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`;

// Sumi-e composite: quantize the blurred luminance into N ink-wash bands
// (darker source → more ink), layer Sobel-derived brush-edge strokes on
// top, tint between paper and ink colors, add paper grain.
const SUMIE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform vec2  u_res;
uniform int   u_washLevels;
uniform float u_washStrength;
uniform float u_washSoftness;
uniform float u_edgeThreshold;
uniform float u_edgeStrength;
uniform vec3  u_inkColor;
uniform vec3  u_paperColor;
uniform float u_grain;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y)).rgb;
}

float sobelMag(float x, float y) {
  float a = lum(samplePx(x-1.0,y-1.0)) * 255.0;
  float b = lum(samplePx(x,   y-1.0)) * 255.0;
  float c = lum(samplePx(x+1.0,y-1.0)) * 255.0;
  float d = lum(samplePx(x-1.0,y    )) * 255.0;
  float f = lum(samplePx(x+1.0,y    )) * 255.0;
  float g = lum(samplePx(x-1.0,y+1.0)) * 255.0;
  float h = lum(samplePx(x,   y+1.0)) * 255.0;
  float iv= lum(samplePx(x+1.0,y+1.0)) * 255.0;
  float gx = (c + 2.0*f + iv) - (a + 2.0*d + g);
  float gy = (g + 2.0*h + iv) - (a + 2.0*b + c);
  return sqrt(gx*gx + gy*gy);
}

// 2D hash for paper grain — cheap, aliased but the filter is about
// texture not signal fidelity.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Wash from blurred luminance — inverted so dark source = more ink.
  float bl = lum(texture(u_blurred, v_uv).rgb);
  float inverted = clamp(1.0 - bl, 0.0, 1.0);
  // Posterize with smoothstep transitions between bands (softness 0 = hard
  // bands, 1 = continuous). We quantize inverted into washLevels buckets,
  // then soft-step across each bucket boundary.
  float lvls = float(u_washLevels);
  float band = floor(inverted * lvls) / lvls;
  float frac = inverted * lvls - floor(inverted * lvls);
  float softEdge = smoothstep(0.5 - u_washSoftness * 0.5, 0.5 + u_washSoftness * 0.5, frac);
  float wash = band + softEdge / lvls;
  wash *= u_washStrength;

  // Sobel brush edges — normalized against a 0-442 range (max Sobel for
  // 8-bit). Only strong edges contribute to keep strokes sparse.
  float edgeRaw = sobelMag(x, y) / 442.0;
  float edgeInk = smoothstep(u_edgeThreshold, min(1.0, u_edgeThreshold + 0.15), edgeRaw) * u_edgeStrength;

  float ink = clamp(max(wash, edgeInk), 0.0, 1.0);

  // Paper grain — subtracts small amounts from ink (flecks of untouched
  // paper showing through) rather than adding, which keeps the image from
  // getting overall darker.
  float n = hash(vec2(x, y));
  ink = clamp(ink - (n - 0.5) * u_grain, 0.0, 1.0);

  vec3 color = mix(u_paperColor, u_inkColor, ink);
  float a = texture(u_source, v_uv).a;
  fragColor = vec4(color, a);
}
`;

type Cache = { gauss: Program; sumie: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    gauss: linkProgram(gl, GAUSS_FS, ["u_input", "u_res", "u_dir", "u_sigma", "u_radius"] as const),
    sumie: linkProgram(gl, SUMIE_FS, [
      "u_source", "u_blurred", "u_res", "u_washLevels", "u_washStrength",
      "u_washSoftness", "u_edgeThreshold", "u_edgeStrength",
      "u_inkColor", "u_paperColor", "u_grain",
    ] as const),
  };
  return _cache;
};

export const sumiEGLAvailable = (): boolean => glAvailable();

export const renderSumiEGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  brushSoftness: number,
  washLevels: number,
  washStrength: number,
  washSoftness: number,
  edgeThreshold: number,
  edgeStrength: number,
  inkColor: number[],
  paperColor: number[],
  grain: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  const sigma = Math.max(0.1, brushSoftness);
  const radius = Math.min(MAX_BLUR, Math.ceil(sigma * 3));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "sumie:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const tempH = ensureTexture(gl, "sumie:tempH", width, height);
  drawPass(gl, tempH, width, height, cache.gauss, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.gauss.uniforms.u_input, 0);
    gl.uniform2f(cache.gauss.uniforms.u_res, width, height);
    gl.uniform2f(cache.gauss.uniforms.u_dir, 1 / width, 0);
    gl.uniform1f(cache.gauss.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.gauss.uniforms.u_radius, radius);
  }, vao);

  const blurTex = ensureTexture(gl, "sumie:blur", width, height);
  drawPass(gl, blurTex, width, height, cache.gauss, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tempH.tex);
    gl.uniform1i(cache.gauss.uniforms.u_input, 0);
    gl.uniform2f(cache.gauss.uniforms.u_res, width, height);
    gl.uniform2f(cache.gauss.uniforms.u_dir, 0, 1 / height);
    gl.uniform1f(cache.gauss.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.gauss.uniforms.u_radius, radius);
  }, vao);

  drawPass(gl, null, width, height, cache.sumie, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.sumie.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurTex.tex);
    gl.uniform1i(cache.sumie.uniforms.u_blurred, 1);
    gl.uniform2f(cache.sumie.uniforms.u_res, width, height);
    gl.uniform1i(cache.sumie.uniforms.u_washLevels, Math.max(2, Math.min(6, Math.round(washLevels))));
    gl.uniform1f(cache.sumie.uniforms.u_washStrength, washStrength);
    gl.uniform1f(cache.sumie.uniforms.u_washSoftness, washSoftness);
    gl.uniform1f(cache.sumie.uniforms.u_edgeThreshold, edgeThreshold);
    gl.uniform1f(cache.sumie.uniforms.u_edgeStrength, edgeStrength);
    gl.uniform3f(cache.sumie.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
    gl.uniform3f(cache.sumie.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
    gl.uniform1f(cache.sumie.uniforms.u_grain, grain);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
