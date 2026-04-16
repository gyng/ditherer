import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Perlin / Simplex / Worley FBM noise generator mixed over the source.
// The hash uses exact uint32 wrap (vs JS float64 mid-multiply precision
// loss), which shifts the exact pattern but keeps the noise character.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_type;       // 0 gradient/perlin, 1 simplex, 2 worley
uniform float u_scale;
uniform int   u_octaves;
uniform int   u_seed;
uniform int   u_frame;
uniform int   u_colorize;
uniform float u_mix;

uint hashU(int x, int y, int seed) {
  uint h = uint(seed) + uint(x) * 374761393u + uint(y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

float hashF(int x, int y, int seed) {
  return float(hashU(x, y, seed)) / 4294967296.0;
}

float gradientNoise(float px, float py, int seed) {
  int x0 = int(floor(px));
  int y0 = int(floor(py));
  float fx = px - float(x0);
  float fy = py - float(y0);
  float u = fx * fx * (3.0 - 2.0 * fx);
  float v = fy * fy * (3.0 - 2.0 * fy);

  float gxs[4] = float[4]( 1.0, -1.0,  1.0, -1.0);
  float gys[4] = float[4]( 1.0,  1.0, -1.0, -1.0);

  int h00 = int(hashU(x0,     y0,     seed) & 3u);
  int h10 = int(hashU(x0 + 1, y0,     seed) & 3u);
  int h01 = int(hashU(x0,     y0 + 1, seed) & 3u);
  int h11 = int(hashU(x0 + 1, y0 + 1, seed) & 3u);
  float n00 = gxs[h00] * (px - float(x0))     + gys[h00] * (py - float(y0));
  float n10 = gxs[h10] * (px - float(x0 + 1)) + gys[h10] * (py - float(y0));
  float n01 = gxs[h01] * (px - float(x0))     + gys[h01] * (py - float(y0 + 1));
  float n11 = gxs[h11] * (px - float(x0 + 1)) + gys[h11] * (py - float(y0 + 1));
  float nx0 = n00 + u * (n10 - n00);
  float nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0);
}

float simplexNoise(float px, float py, int seed) {
  float F2 = 0.5 * (sqrt(3.0) - 1.0);
  float G2 = (3.0 - sqrt(3.0)) / 6.0;
  float s = (px + py) * F2;
  int i = int(floor(px + s));
  int j = int(floor(py + s));
  float t = float(i + j) * G2;
  float x0 = px - (float(i) - t);
  float y0 = py - (float(j) - t);
  int i1 = x0 > y0 ? 1 : 0;
  int j1 = x0 > y0 ? 0 : 1;
  float x1 = x0 - float(i1) + G2;
  float y1 = y0 - float(j1) + G2;
  float x2 = x0 - 1.0 + 2.0 * G2;
  float y2 = y0 - 1.0 + 2.0 * G2;

  float gxs[4] = float[4]( 1.0, -1.0,  1.0, -1.0);
  float gys[4] = float[4]( 1.0,  1.0, -1.0, -1.0);

  float result = 0.0;
  int ii[3]; int jj[3]; float xx[3]; float yy[3];
  ii[0] = i;       jj[0] = j;       xx[0] = x0; yy[0] = y0;
  ii[1] = i + i1;  jj[1] = j + j1;  xx[1] = x1; yy[1] = y1;
  ii[2] = i + 1;   jj[2] = j + 1;   xx[2] = x2; yy[2] = y2;
  for (int k = 0; k < 3; k++) {
    float tval = 0.5 - xx[k] * xx[k] - yy[k] * yy[k];
    if (tval < 0.0) continue;
    int h = int(hashU(ii[k], jj[k], seed) & 3u);
    result += tval * tval * tval * tval * (gxs[h] * xx[k] + gys[h] * yy[k]);
  }
  return 70.0 * result;
}

float worleyNoise(float px, float py, int seed) {
  int ix = int(floor(px));
  int iy = int(floor(py));
  float minDist = 1e9;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      int cx = ix + dx;
      int cy = iy + dy;
      uint h = hashU(cx, cy, seed);
      float fpx = float(cx) + float(h & 0xffffu) / 65536.0;
      float fpy = float(cy) + float((h >> 16) & 0xffffu) / 65536.0;
      float ddx = px - fpx;
      float ddy = py - fpy;
      float d2 = ddx * ddx + ddy * ddy;
      if (d2 < minDist) minDist = d2;
    }
  }
  return sqrt(minDist);
}

float sampleNoise(float px, float py, int seed) {
  if (u_type == 0) return gradientNoise(px, py, seed);
  if (u_type == 1) return simplexNoise(px, py, seed);
  return worleyNoise(px, py, seed);
}

vec3 hslToRgb(float hue, float sat, float lit) {
  float c = (1.0 - abs(2.0 * lit - 1.0)) * sat;
  float hh = mod(mod(hue, 360.0) + 360.0, 360.0);
  float xc = c * (1.0 - abs(mod(hh / 60.0, 2.0) - 1.0));
  float m = lit - c * 0.5;
  vec3 rgb;
  if (hh < 60.0)       rgb = vec3(c, xc, 0.0);
  else if (hh < 120.0) rgb = vec3(xc, c, 0.0);
  else if (hh < 180.0) rgb = vec3(0.0, c, xc);
  else if (hh < 240.0) rgb = vec3(0.0, xc, c);
  else if (hh < 300.0) rgb = vec3(xc, 0.0, c);
  else                 rgb = vec3(c, 0.0, xc);
  return floor((rgb + vec3(m)) * 255.0 + 0.5);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float value = 0.0;
  float amplitude = 1.0;
  float frequency = 1.0;
  float maxAmp = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= u_octaves) break;
    float nx = (jsX / u_scale) * frequency;
    float ny = (jsY / u_scale) * frequency;
    value += sampleNoise(nx, ny, u_seed + o * 1000 + u_frame * 7) * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }

  float n = clamp((value / max(1e-6, maxAmp) + 1.0) * 0.5, 0.0, 1.0);

  vec3 noiseRgb;
  if (u_colorize == 1) {
    noiseRgb = hslToRgb(n * 360.0, 0.8, 0.5);
  } else {
    float v = floor(n * 255.0 + 0.5);
    noiseRgb = vec3(v);
  }

  vec4 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));
  vec3 srcRgb = src.rgb * 255.0;
  vec3 outRgb = floor(srcRgb * (1.0 - u_mix) + noiseRgb * u_mix + 0.5);
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_type", "u_scale", "u_octaves",
    "u_seed", "u_frame", "u_colorize", "u_mix",
  ] as const) };
  return _cache;
};

export const noiseGeneratorGLAvailable = (): boolean => glAvailable();

export type NoiseType = 0 | 1 | 2;

export const renderNoiseGeneratorGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  type: NoiseType, scale: number, octaves: number,
  seed: number, frame: number, colorize: boolean, mix: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "noiseGenerator:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_type, type);
    gl.uniform1f(cache.prog.uniforms.u_scale, scale);
    gl.uniform1i(cache.prog.uniforms.u_octaves, Math.max(1, Math.min(8, Math.round(octaves))));
    gl.uniform1i(cache.prog.uniforms.u_seed, seed | 0);
    gl.uniform1i(cache.prog.uniforms.u_frame, frame | 0);
    gl.uniform1i(cache.prog.uniforms.u_colorize, colorize ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_mix, mix);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
