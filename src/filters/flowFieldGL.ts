import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Curl-noise flow-field advection. For each fragment we start at the
// source pixel and take N steps along the curl tangent, accumulating
// bilinear source samples at each trace point. The JS hash truncates
// at float64 precision mid-multiply; we use exact uint32 wrap in GLSL,
// so the noise field is similar in character but the exact advection
// path differs slightly.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_scale;
uniform float u_stepDist;
uniform int   u_steps;
uniform uint  u_seed;

uint hash32(int ix, int iy) {
  uint h = u_seed + uint(ix) * 374761393u + uint(iy) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

float hashFloat(int ix, int iy) {
  return float(hash32(ix, iy)) / 4294967296.0;
}

float noise2d(float px, float py) {
  int x0 = int(floor(px));
  int y0 = int(floor(py));
  float fx = px - float(x0);
  float fy = py - float(y0);
  float u = fx * fx * (3.0 - 2.0 * fx);
  float v = fy * fy * (3.0 - 2.0 * fy);
  float n00 = hashFloat(x0,     y0)     * 2.0 - 1.0;
  float n10 = hashFloat(x0 + 1, y0)     * 2.0 - 1.0;
  float n01 = hashFloat(x0,     y0 + 1) * 2.0 - 1.0;
  float n11 = hashFloat(x0 + 1, y0 + 1) * 2.0 - 1.0;
  return n00 * (1.0 - u) * (1.0 - v)
       + n10 *  u        * (1.0 - v)
       + n01 * (1.0 - u) *  v
       + n11 *  u        *  v;
}

float curlAngle(float px, float py) {
  float eps = 0.01;
  float dndx = (noise2d(px + eps, py) - noise2d(px - eps, py)) / (2.0 * eps);
  float dndy = (noise2d(px, py + eps) - noise2d(px, py - eps)) / (2.0 * eps);
  return atan(dndx, -dndy);
}

vec4 sampleBilinearJS(float px, float py) {
  float clampedX = clamp(px, 0.0, u_res.x - 1.0);
  float clampedY = clamp(py, 0.0, u_res.y - 1.0);
  float x0 = floor(clampedX);
  float y0 = floor(clampedY);
  float fx = clampedX - x0;
  float fy = clampedY - y0;
  float x1 = min(x0 + 1.0, u_res.x - 1.0);
  float y1 = min(y0 + 1.0, u_res.y - 1.0);
  vec4 a00 = texture(u_source, vec2((x0 + 0.5) / u_res.x, 1.0 - (y0 + 0.5) / u_res.y));
  vec4 a10 = texture(u_source, vec2((x1 + 0.5) / u_res.x, 1.0 - (y0 + 0.5) / u_res.y));
  vec4 a01 = texture(u_source, vec2((x0 + 0.5) / u_res.x, 1.0 - (y1 + 0.5) / u_res.y));
  vec4 a11 = texture(u_source, vec2((x1 + 0.5) / u_res.x, 1.0 - (y1 + 0.5) / u_res.y));
  return (a00 * (1.0 - fx) + a10 * fx) * (1.0 - fy)
       + (a01 * (1.0 - fx) + a11 * fx) *  fy;
}

void main() {
  vec2 ppx = v_uv * u_res;
  float jsX = floor(ppx.x);
  float jsY = u_res.y - 1.0 - floor(ppx.y);

  float px = jsX;
  float py = jsY;

  vec4 acc = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));

  for (int s = 0; s < 20; s++) {
    if (s >= u_steps) break;
    float angle = curlAngle(px / u_scale, py / u_scale);
    px += cos(angle) * u_stepDist;
    py += sin(angle) * u_stepDist;
    acc += sampleBilinearJS(px, py);
  }

  float n = float(u_steps) + 1.0;
  fragColor = acc / n;
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_scale", "u_stepDist", "u_steps", "u_seed",
  ] as const) };
  return _cache;
};

export const flowFieldGLAvailable = (): boolean => glAvailable();

export const renderFlowFieldGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  scale: number, strength: number, steps: number, seed: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "flowField:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const stepDist = strength / Math.max(1, steps);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_scale, scale);
    gl.uniform1f(cache.prog.uniforms.u_stepDist, stepDist);
    gl.uniform1i(cache.prog.uniforms.u_steps, steps | 0);
    gl.uniform1ui(cache.prog.uniforms.u_seed, (seed >>> 0));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
