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

// Single-pass 2D convolution, up to 5×5 kernel (covers every built-in kernel
// in convolve.ts). Matrix is pre-multiplied by strength on the CPU and passed
// as a 25-slot float array. Pixels outside the canvas clamp to the nearest
// edge, matching the JS max/min clamp behaviour.
export const MAX_KW = 5;

const CONVOLVE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_kWidth;                // 1, 3, or 5
uniform int   u_linearize;             // 0 = sRGB-space convolve, 1 = linear
uniform float u_kernel[${MAX_KW * MAX_KW}]; // row-major, kernel[ky*MAX_KW + kx]

// IEC 61966-2-1 sRGB transfer. Matches the CPU's SRGB_TO_LINEAR_F LUT within
// one LSB for inputs snapped to /255 steps.
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  float halfK = floor(float(u_kWidth) * 0.5);

  vec3 acc = vec3(0.0);
  for (int ky = 0; ky < ${MAX_KW}; ky++) {
    if (ky >= u_kWidth) break;
    for (int kx = 0; kx < ${MAX_KW}; kx++) {
      if (kx >= u_kWidth) break;
      float k = u_kernel[ky * ${MAX_KW} + kx];
      if (k == 0.0) continue;
      float sx = clamp(x + float(kx) - halfK, 0.0, u_res.x - 1.0);
      float sy = clamp(y + float(ky) - halfK, 0.0, u_res.y - 1.0);
      vec3 c = texture(u_source, (vec2(sx, sy) + 0.5) / u_res).rgb;
      if (u_linearize == 1) c = srgbToLinear(c);
      acc += c * k;
    }
  }

  vec4 centre = texture(u_source, (vec2(x, y) + 0.5) / u_res);
  vec3 outRgb = u_linearize == 1 ? linearToSrgb(clamp(acc, 0.0, 1.0)) : clamp(acc, 0.0, 1.0);
  fragColor = vec4(outRgb, centre.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, CONVOLVE_FS, [
      "u_source", "u_res", "u_kWidth", "u_linearize", "u_kernel[0]",
    ] as const),
  };
  return _cache;
};

export const convolveGLAvailable = (): boolean => glAvailable();

export const renderConvolveGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  matrix: (number | null | undefined)[][],
  kWidth: number,
  linearize: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (kWidth < 1 || kWidth > MAX_KW) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const flat = new Float32Array(MAX_KW * MAX_KW);
  for (let ky = 0; ky < kWidth; ky++) {
    for (let kx = 0; kx < kWidth; kx++) {
      flat[ky * MAX_KW + kx] = matrix[ky]?.[kx] ?? 0;
    }
  }

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "convolve:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_kWidth, kWidth);
    gl.uniform1i(cache.prog.uniforms.u_linearize, linearize ? 1 : 0);
    const loc = cache.prog.uniforms["u_kernel[0]"];
    if (loc) gl.uniform1fv(loc, flat);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
