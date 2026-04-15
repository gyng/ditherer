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

// Per-pixel min-filter over a (2*spread+1)² square, blending each neighbour's
// luminance with the centre using absorbency*weight, then compositing ink over
// a paper tint with per-pixel grain noise. Mirrors the JS reference in
// inkBleed.ts — a single full-screen draw replaces the nested CPU loop.
const INK_BLEED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_spread;
uniform float u_absorbency;
uniform vec3  u_paperTint;    // 0..255 range, matches JS
uniform float u_grain;

float getLum(vec3 c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// Matches JS noise() = Math.sin(x*91.7 + y*317.3) * 43758.5453; fractional part.
float noise2(float x, float y) {
  return fract(sin(x * 91.7 + y * 317.3) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);

  vec4 centre = texture(u_source, (vec2(x, y) + 0.5) / u_res);
  float lum = getLum(centre.rgb) * 255.0;
  float darkest = lum;
  float spreadF = max(1.0, float(u_spread));

  // Square kernel, bounded at 25 to keep the inner loop unrolled on all GPUs.
  // spread is clamped to [0,12] by the filter UI.
  for (int ky = -12; ky <= 12; ky++) {
    if (ky < -u_spread || ky > u_spread) continue;
    for (int kx = -12; kx <= 12; kx++) {
      if (kx < -u_spread || kx > u_spread) continue;
      float nx = clamp(x + float(kx), 0.0, u_res.x - 1.0);
      float ny = clamp(y + float(ky), 0.0, u_res.y - 1.0);
      vec3 nc = texture(u_source, (vec2(nx, ny) + 0.5) / u_res).rgb;
      float nLum = getLum(nc) * 255.0;
      float dist = sqrt(float(kx * kx + ky * ky));
      float weight = max(0.0, 1.0 - dist / spreadF);
      float blended = lum * (1.0 - u_absorbency * weight) + nLum * u_absorbency * weight;
      darkest = min(darkest, blended);
    }
  }

  float inkAmount = 1.0 - darkest / 255.0;
  // UNPACK_FLIP_Y=true means GL-y is inverted JS-y; use JS-y for the noise so
  // the grain pattern matches the CPU reference bit-for-bit on identical pixels.
  float yJs = u_res.y - 1.0 - y;
  float grainJitter = (noise2(x, yJs) - 0.5) * u_grain * 40.0;

  vec3 c255 = centre.rgb * 255.0;
  vec3 out255 = u_paperTint * (1.0 - inkAmount)
              + max(vec3(0.0), c255 + vec3(grainJitter)) * inkAmount;

  fragColor = vec4(out255 / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, INK_BLEED_FS, [
      "u_source", "u_res", "u_spread", "u_absorbency", "u_paperTint", "u_grain",
    ] as const),
  };
  return _cache;
};

export const inkBleedGLAvailable = (): boolean => glAvailable();

export const renderInkBleedGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  spread: number,
  absorbency: number,
  paperTint: [number, number, number],
  grain: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "inkBleed:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_spread, spread);
    gl.uniform1f(cache.prog.uniforms.u_absorbency, absorbency);
    gl.uniform3f(cache.prog.uniforms.u_paperTint, paperTint[0], paperTint[1], paperTint[2]);
    gl.uniform1f(cache.prog.uniforms.u_grain, grain);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
