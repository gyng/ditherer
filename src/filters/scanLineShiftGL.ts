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

// Scan-line horizontal shift. Each block of `blockHeight` rows either shifts
// by a per-block random amount (if `chance` roll passes) or passes through.
// Optional per-block R-channel offset for colour separation. Hash-based
// per-block RNG (won't match JS mulberry32 sequence bit-for-bit but visually
// equivalent — same distribution and seed on frameIndex).
const SCANLINE_SHIFT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_blockHeight;
uniform int   u_maxShift;
uniform float u_chance;
uniform int   u_colorShift;
uniform int   u_wrap;
uniform float u_frameSeed;
uniform float u_levels;

float hash1(float key, float seed) {
  return fract(sin(key * 12.9898 + seed * 78.233) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  // JS-y so the block-index math matches the CPU reference.
  int yo = int(u_res.y) - 1 - int(floor(px.y));

  int blockY = (yo / u_blockHeight) * u_blockHeight;
  float bk = float(blockY);

  // Per-block random: first draw decides whether to shift, second draws are
  // the main shift + optional R-channel shift (same order as the CPU path).
  bool shouldShift = hash1(bk, u_frameSeed) < u_chance;
  int shift = 0;
  int rShift = 0;
  if (shouldShift) {
    float s = hash1(bk + 1.0, u_frameSeed) * 2.0 - 1.0;
    shift = int(floor(s * float(u_maxShift) + 0.5));
    if (u_colorShift == 1) {
      float rsMax = min(float(u_maxShift), 10.0);
      float rs = hash1(bk + 2.0, u_frameSeed) * 2.0 - 1.0;
      rShift = int(floor(rs * rsMax + 0.5));
    }
  }

  int srcX  = xo - shift;
  int srcXR = xo - shift - rShift;
  int W = int(u_res.x);

  bool outOfBounds = false;
  if (u_wrap == 1) {
    srcX  = ((srcX % W) + W) % W;
    srcXR = ((srcXR % W) + W) % W;
  } else if (srcX < 0 || srcX >= W) {
    outOfBounds = true;
  }

  if (outOfBounds) {
    vec3 rgb = vec3(0.0);
    if (u_levels > 1.5) {
      float q = u_levels - 1.0;
      rgb = floor(rgb * q + 0.5) / q;
    }
    fragColor = vec4(rgb, 1.0);
    return;
  }

  // Build sample UVs in JS-y coords, then convert via UNPACK_FLIP_Y.
  vec2 mainUV = vec2((float(srcX)  + 0.5) / u_res.x, 1.0 - (float(yo) + 0.5) / u_res.y);
  vec2 rUV    = vec2((float(srcXR) + 0.5) / u_res.x, 1.0 - (float(yo) + 0.5) / u_res.y);
  vec4 main = texture(u_source, mainUV);
  float r = main.r;
  if (u_colorShift == 1 && rShift != 0 && srcXR >= 0 && srcXR < W) {
    r = texture(u_source, rUV).r;
  }

  vec3 rgb = vec3(r, main.g, main.b);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, main.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, SCANLINE_SHIFT_FS, [
      "u_source", "u_res", "u_blockHeight", "u_maxShift", "u_chance",
      "u_colorShift", "u_wrap", "u_frameSeed", "u_levels",
    ] as const),
  };
  return _cache;
};

export const scanLineShiftGLAvailable = (): boolean => glAvailable();

export const renderScanLineShiftGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  maxShift: number,
  blockHeight: number,
  chance: number,
  colorShift: boolean,
  wrap: boolean,
  frameIndex: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "scanLineShift:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_blockHeight, Math.max(1, Math.round(blockHeight)));
    gl.uniform1i(cache.prog.uniforms.u_maxShift, Math.max(0, Math.round(maxShift)));
    gl.uniform1f(cache.prog.uniforms.u_chance, chance);
    gl.uniform1i(cache.prog.uniforms.u_colorShift, colorShift ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_wrap, wrap ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_frameSeed, frameIndex * 7919 + 31337);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
