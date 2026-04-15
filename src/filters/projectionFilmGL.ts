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

// Projection film has three distinct phases:
//   1. Per-pixel composite — gate-weave offset source sample + warmth + flicker
//      + grain + vignette + dust specks + scratch lines. Runs in a single
//      fragment shader with dust/scratch positions uploaded as uniform arrays.
//   2. Extract bright pixels and separably blur them for the projector bloom.
//   3. Additive composite of bloom onto the per-pixel result.
export const MAX_DUST = 64;
export const MAX_SCRATCH = 16;

// Pass 1: per-pixel composite. Dust + scratches tested via pixel-distance
// checks against the uniform arrays — branch cost is bounded by MAX_DUST /
// MAX_SCRATCH with early-break on the count sentinel.
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_weaveX;
uniform int   u_weaveY;
uniform float u_warmth;
uniform float u_flickerMul;
uniform float u_grain;
uniform float u_grainSeed;
uniform float u_vignette;
uniform int   u_dustCount;
uniform vec3  u_dust[${MAX_DUST}];        // (x_js, y_js, radius) ; opacity below
uniform float u_dustOpacity[${MAX_DUST}];
uniform int   u_scratchCount;
uniform vec2  u_scratch[${MAX_SCRATCH}];  // (x_js, opacity)
uniform float u_levels;

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_js = u_res.y - 1.0 - floor(px.y);

  // Gate weave — integer source offset.
  float sx = clamp(x + float(u_weaveX), 0.0, u_res.x - 1.0);
  float sy = clamp(y_js + float(u_weaveY), 0.0, u_res.y - 1.0);
  vec2 sUV = vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y);
  vec3 c = texture(u_source, sUV).rgb * 255.0;

  // Warm color cast.
  if (u_warmth > 0.0) {
    c.r = c.r + (255.0 - c.r) * u_warmth * 0.12;
    c.g = c.g + (255.0 - c.g) * u_warmth * 0.04;
    c.b = c.b * (1.0 - u_warmth * 0.08);
  }

  c *= u_flickerMul;

  if (u_grain > 0.0) {
    float n = (hash(vec2(x, y_js), u_grainSeed) - 0.5) * u_grain * 100.0;
    c += vec3(n);
  }

  if (u_vignette > 0.0) {
    float cx = u_res.x * 0.5;
    float cy = u_res.y * 0.5;
    float maxDist = sqrt(cx * cx + cy * cy);
    float dxv = x - cx;
    float dyv = y_js - cy;
    float dist = sqrt(dxv * dxv + dyv * dyv) / maxDist;
    float vigFactor = 1.0 - dist * dist * u_vignette;
    c *= vigFactor;
  }

  c = clamp(c, 0.0, 255.0);

  // Dust specks: white screen-blend where this pixel is inside a disc.
  for (int i = 0; i < ${MAX_DUST}; i++) {
    if (i >= u_dustCount) break;
    vec3 d = u_dust[i];
    float dx = x - d.x;
    float dy = y_js - d.y;
    if (dx * dx + dy * dy <= d.z * d.z) {
      float op = u_dustOpacity[i];
      c = min(vec3(255.0), c + (vec3(255.0) - c) * op);
    }
  }

  // Scratches: thin vertical white lines (pixel-wide x match).
  for (int i = 0; i < ${MAX_SCRATCH}; i++) {
    if (i >= u_scratchCount) break;
    vec2 s = u_scratch[i];
    if (abs(x - s.x) < 0.5) {
      c = min(vec3(255.0), c + (vec3(255.0) - c) * s.y);
    }
  }

  vec3 rgb = clamp(c, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

// Pass 2: horizontal blur of the bright-pixels-minus-threshold (stored as
// positive RGB in temp1). Matches the JS `bright[j] = max(0, v - 160)`.
const BLOOM_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;

void main() {
  vec2 px = v_uv * u_res;
  float y = floor(px.y);
  vec3 acc = vec3(0.0);
  float cnt = 0.0;
  for (int k = -15; k <= 15; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(floor(px.x) + float(k), 0.0, u_res.x - 1.0);
    vec3 c = texture(u_input, (vec2(nx, y) + 0.5) / u_res).rgb * 255.0;
    acc += max(vec3(0.0), c - 160.0);
    cnt += 1.0;
  }
  fragColor = vec4(acc / cnt / 255.0, 1.0);
}
`;

// Pass 3: vertical blur + additive composite. Reads the H-blurred bright
// texture and the original composite texture, sums them with the bloom
// scale, writes final output.
const BLOOM_V_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_composite;
uniform sampler2D u_brightH;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_bloom;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  vec3 acc = vec3(0.0);
  float cnt = 0.0;
  for (int k = -15; k <= 15; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny = clamp(floor(px.y) + float(k), 0.0, u_res.y - 1.0);
    acc += texture(u_brightH, (vec2(x, ny) + 0.5) / u_res).rgb * 255.0;
    cnt += 1.0;
  }
  vec3 bloom = acc / cnt;

  vec4 composite = texture(u_composite, v_uv);
  vec3 c255 = composite.rgb * 255.0;
  c255 = min(vec3(255.0), c255 + bloom * u_bloom);
  fragColor = vec4(c255 / 255.0, composite.a);
}
`;

type Cache = {
  composite: Program;
  bloomH: Program;
  bloomV: Program;
};
let _cache: Cache | null = null;

const compositeUniforms: string[] = [
  "u_source", "u_res", "u_weaveX", "u_weaveY", "u_warmth", "u_flickerMul",
  "u_grain", "u_grainSeed", "u_vignette",
  "u_dustCount", "u_dust[0]", "u_dustOpacity[0]",
  "u_scratchCount", "u_scratch[0]", "u_levels",
];

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    composite: linkProgram(gl, COMPOSITE_FS, compositeUniforms as unknown as readonly string[]),
    bloomH: linkProgram(gl, BLOOM_H_FS, ["u_input", "u_res", "u_radius"] as const),
    bloomV: linkProgram(gl, BLOOM_V_FS, ["u_composite", "u_brightH", "u_res", "u_radius", "u_bloom"] as const),
  };
  return _cache;
};

export const projectionFilmGLAvailable = (): boolean => glAvailable();

export type DustSpec = { x: number; y: number; radius: number; opacity: number };
export type ScratchSpec = { x: number; opacity: number };

export const renderProjectionFilmGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: {
    weaveX: number;
    weaveY: number;
    warmth: number;
    flickerMul: number;
    grain: number;
    grainSeed: number;
    vignette: number;
    dust: DustSpec[];
    scratches: ScratchSpec[];
    bloom: number;
    bloomRadius: number;
    levels: number;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const dustCount = Math.min(MAX_DUST, params.dust.length);
  const flatDust = new Float32Array(MAX_DUST * 3);
  const flatDustOp = new Float32Array(MAX_DUST);
  for (let i = 0; i < dustCount; i++) {
    flatDust[i * 3] = params.dust[i].x;
    flatDust[i * 3 + 1] = params.dust[i].y;
    flatDust[i * 3 + 2] = params.dust[i].radius;
    flatDustOp[i] = params.dust[i].opacity;
  }
  const scratchCount = Math.min(MAX_SCRATCH, params.scratches.length);
  const flatScratch = new Float32Array(MAX_SCRATCH * 2);
  for (let i = 0; i < scratchCount; i++) {
    flatScratch[i * 2] = params.scratches[i].x;
    flatScratch[i * 2 + 1] = params.scratches[i].opacity;
  }
  const bloomR = Math.max(1, Math.min(15, Math.round(params.bloomRadius)));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "projection:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const compTex = ensureTexture(gl, "projection:composite", width, height);
  const brightH = ensureTexture(gl, "projection:brightH", width, height);

  // Pass 1: per-pixel composite → compTex
  drawPass(gl, compTex, width, height, cache.composite, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_source, 0);
    gl.uniform2f(cache.composite.uniforms.u_res, width, height);
    gl.uniform1i(cache.composite.uniforms.u_weaveX, params.weaveX);
    gl.uniform1i(cache.composite.uniforms.u_weaveY, params.weaveY);
    gl.uniform1f(cache.composite.uniforms.u_warmth, params.warmth);
    gl.uniform1f(cache.composite.uniforms.u_flickerMul, params.flickerMul);
    gl.uniform1f(cache.composite.uniforms.u_grain, params.grain);
    gl.uniform1f(cache.composite.uniforms.u_grainSeed, params.grainSeed);
    gl.uniform1f(cache.composite.uniforms.u_vignette, params.vignette);
    gl.uniform1i(cache.composite.uniforms.u_dustCount, dustCount);
    const locDust = cache.composite.uniforms["u_dust[0]"];
    if (locDust) gl.uniform3fv(locDust, flatDust);
    const locDustOp = cache.composite.uniforms["u_dustOpacity[0]"];
    if (locDustOp) gl.uniform1fv(locDustOp, flatDustOp);
    gl.uniform1i(cache.composite.uniforms.u_scratchCount, scratchCount);
    const locScratch = cache.composite.uniforms["u_scratch[0]"];
    if (locScratch) gl.uniform2fv(locScratch, flatScratch);
    gl.uniform1f(cache.composite.uniforms.u_levels, params.levels);
  }, vao);

  if (params.bloom > 0) {
    drawPass(gl, brightH, width, height, cache.bloomH, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, compTex.tex);
      gl.uniform1i(cache.bloomH.uniforms.u_input, 0);
      gl.uniform2f(cache.bloomH.uniforms.u_res, width, height);
      gl.uniform1i(cache.bloomH.uniforms.u_radius, bloomR);
    }, vao);

    drawPass(gl, null, width, height, cache.bloomV, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, compTex.tex);
      gl.uniform1i(cache.bloomV.uniforms.u_composite, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, brightH.tex);
      gl.uniform1i(cache.bloomV.uniforms.u_brightH, 1);
      gl.uniform2f(cache.bloomV.uniforms.u_res, width, height);
      gl.uniform1i(cache.bloomV.uniforms.u_radius, bloomR);
      gl.uniform1f(cache.bloomV.uniforms.u_bloom, params.bloom);
    }, vao);
  } else {
    // No bloom: just readout the composite directly by re-drawing it.
    drawPass(gl, null, width, height, cache.bloomV, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, compTex.tex);
      gl.uniform1i(cache.bloomV.uniforms.u_composite, 0);
      // Use compTex as brightH too; radius=0 makes the inner loop a no-op
      // (single sample, bloom=0 makes the composite a zero contribution).
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, compTex.tex);
      gl.uniform1i(cache.bloomV.uniforms.u_brightH, 1);
      gl.uniform2f(cache.bloomV.uniforms.u_res, width, height);
      gl.uniform1i(cache.bloomV.uniforms.u_radius, 0);
      gl.uniform1f(cache.bloomV.uniforms.u_bloom, 0);
    }, vao);
  }

  return readoutToCanvas(canvas, width, height);
};
