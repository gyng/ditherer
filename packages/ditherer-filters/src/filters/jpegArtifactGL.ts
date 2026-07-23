import {
  drawPass,
  ensureTexture,
  getExistingGLCtx,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

// JPEG codec simulation on the GPU. Chroma reduction is represented in the
// full-size YCbCr plane by box-filtering 2×1 or 2×2 groups before the DCT and
// replicating that chroma sample across its group.
//
// Pipeline (all RGBA32F intermediates, R=Y G=Cb B=Cr packed together):
//   1. source → ycbcr (R=Y, G=Cb, B=Cr, A=source-alpha)
//   2. ycbcr → dct1   (row-wise 1D DCT per block, on all 3 channels)
//   3. dct1  → dct2   (column-wise 1D DCT — full 2D DCT coefficients now)
//   4. dct2  → quant  (per-coefficient quantise + per-block burst/jitter)
//   5. quant → idct1  (column-wise 1D IDCT)
//   6. idct1 → idct2  (row-wise 1D IDCT → reconstructed YCbCr plane)
//   7. idct2 → composite (deblock + ringing + mosquito, YCbCr → RGB → output)

// --- Pass 1: RGB → YCbCr. ---
const TO_YCBCR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_sourceRes;
uniform int u_subsampling;

vec4 sourceAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(u_sourceRes) - ivec2(1));
  return texelFetch(u_source, p, 0);
}

vec3 ycbcr(vec3 rgb01) {
  vec3 rgb = rgb01 * 255.0;
  float Y  = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  float Cb = 128.0 - 0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
  float Cr = 128.0 + 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
  return vec3(Y, Cb, Cr);
}

void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy));
  vec4 s = sourceAt(p);
  vec3 current = ycbcr(s.a > 0.0 ? s.rgb : vec3(0.0));
  if (u_subsampling == 0) { fragColor = vec4(current, s.a); return; }
  ivec2 origin = ivec2((p.x / 2) * 2, u_subsampling == 2 ? (p.y / 2) * 2 : p.y);
  vec2 chroma = vec2(0.0);
  int count = u_subsampling == 2 ? 4 : 2;
  for (int dy = 0; dy < 2; dy++) {
    if (u_subsampling == 1 && dy == 1) break;
    for (int dx = 0; dx < 2; dx++) {
      vec4 sampleValue = sourceAt(origin + ivec2(dx, dy));
      chroma += ycbcr(sampleValue.a > 0.0 ? sampleValue.rgb : vec3(0.0)).gb;
    }
  }
  fragColor = vec4(current.r, chroma / float(count), s.a);
}
`;

// Shared helper — 8×8 block-relative DCT basis. Given pixel coord along the
// scan axis, return cos weight for basis index u.
const DCT_HELPER = `
float inv_sqrt2 = 0.7071067811865475;
float dctBasis(int u, int x) {
  // 0.5 * au * cos((2x+1)*u*PI/16), au = 1/sqrt(2) when u=0, else 1.
  float au = u == 0 ? inv_sqrt2 : 1.0;
  return 0.5 * au * cos((float(2 * x + 1) * float(u) * 3.14159265) / 16.0);
}
`;

// --- Pass 2: row DCT. For each output texel at block-relative (u, y), sum
// src(bx*8+x, by*8+y) * dctBasis(u, x) over x∈[0..7]. ---
const DCT_ROW_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
${DCT_HELPER}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo = int(floor(px.y));
  int bx = xo / 8;
  int u  = xo - bx * 8;
  vec3 sum = vec3(0.0);
  for (int x = 0; x < 8; x++) {
    int sx = bx * 8 + x;
    if (sx >= int(u_res.x)) break;
    vec4 s = texelFetch(u_input, ivec2(sx, yo), 0);
    // The DCT convention subtracts 128 before transform.
    sum += (s.rgb - vec3(128.0)) * dctBasis(u, x);
  }
  fragColor = vec4(sum, 1.0);
}
`;

// --- Pass 3: column DCT on pass-2 result. ---
const DCT_COL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
${DCT_HELPER}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo = int(floor(px.y));
  int by = yo / 8;
  int v  = yo - by * 8;
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 8; y++) {
    int sy = by * 8 + y;
    if (sy >= int(u_res.y)) break;
    sum += texelFetch(u_input, ivec2(xo, sy), 0).rgb * dctBasis(v, y);
  }
  fragColor = vec4(sum, 1.0);
}
`;

// --- Pass 4: quantise. Per-block burst/jitter via hash(block, frameSeed).
// Y uses LUMA_Q, Cb/Cr use CHROMA_Q. High-freq dropout emulates the JS
// "zero out coefficients when burst > 3" behaviour. ---
const LUMA_Q_GLSL = `
float lumaQ(int u, int v) {
  // Hard-coded 8×8 standard luma table, indexed by (v, u).
  if (v == 0) { return u == 0 ? 16.0 : u == 1 ? 11.0 : u == 2 ? 10.0 : u == 3 ? 16.0 : u == 4 ? 24.0 : u == 5 ? 40.0 : u == 6 ? 51.0 : 61.0; }
  if (v == 1) { return u == 0 ? 12.0 : u == 1 ? 12.0 : u == 2 ? 14.0 : u == 3 ? 19.0 : u == 4 ? 26.0 : u == 5 ? 58.0 : u == 6 ? 60.0 : 55.0; }
  if (v == 2) { return u == 0 ? 14.0 : u == 1 ? 13.0 : u == 2 ? 16.0 : u == 3 ? 24.0 : u == 4 ? 40.0 : u == 5 ? 57.0 : u == 6 ? 69.0 : 56.0; }
  if (v == 3) { return u == 0 ? 14.0 : u == 1 ? 17.0 : u == 2 ? 22.0 : u == 3 ? 29.0 : u == 4 ? 51.0 : u == 5 ? 87.0 : u == 6 ? 80.0 : 62.0; }
  if (v == 4) { return u == 0 ? 18.0 : u == 1 ? 22.0 : u == 2 ? 37.0 : u == 3 ? 56.0 : u == 4 ? 68.0 : u == 5 ? 109.0: u == 6 ? 103.0: 77.0; }
  if (v == 5) { return u == 0 ? 24.0 : u == 1 ? 35.0 : u == 2 ? 55.0 : u == 3 ? 64.0 : u == 4 ? 81.0 : u == 5 ? 104.0: u == 6 ? 113.0: 92.0; }
  if (v == 6) { return u == 0 ? 49.0 : u == 1 ? 64.0 : u == 2 ? 78.0 : u == 3 ? 87.0 : u == 4 ? 103.0: u == 5 ? 121.0: u == 6 ? 120.0: 101.0; }
               return u == 0 ? 72.0 : u == 1 ? 92.0 : u == 2 ? 95.0 : u == 3 ? 98.0 : u == 4 ? 112.0: u == 5 ? 100.0: u == 6 ? 103.0: 99.0;
}
float chromaQ(int u, int v) {
  if (v == 0) { return u == 0 ? 17.0 : u == 1 ? 18.0 : u == 2 ? 24.0 : u == 3 ? 47.0 : 99.0; }
  if (v == 1) { return u == 0 ? 18.0 : u == 1 ? 21.0 : u == 2 ? 26.0 : u == 3 ? 66.0 : 99.0; }
  if (v == 2) { return u == 0 ? 24.0 : u == 1 ? 26.0 : u == 2 ? 56.0 : 99.0; }
  if (v == 3) { return u == 0 ? 47.0 : u == 1 ? 66.0 : 99.0; }
  return 99.0;
}
`;

const QUANTISE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform float u_qLumaScale;
uniform float u_qChromaScale;
uniform float u_gridJitter;
uniform float u_corruptBurstChance;
uniform float u_frameSeed;
${LUMA_Q_GLSL}

float hash1(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo = int(floor(px.y));
  int bx = xo / 8;
  int by = yo / 8;
  int u  = xo - bx * 8;
  int v  = yo - by * 8;
  int i  = v * 8 + u;

  // Per-block pseudo-random burst/jitter. Matches the JS behaviour
  // qualitatively; doesn't share the mulberry32 sequence.
  vec2 blockId = vec2(bx, by);
  float r1 = hash1(blockId, u_frameSeed);
  float burst = r1 < u_corruptBurstChance
    ? 1.8 + hash1(blockId + vec2(13.0, 7.0), u_frameSeed) * 4.5
    : 1.0;
  float r2 = hash1(blockId + vec2(31.0, 17.0), u_frameSeed);
  float jitter = clamp(1.0 + (r2 - 0.5) * 2.0 * u_gridJitter, 0.25, 3.0);

  float highFreqPenalty = (i > 10 && burst > 1.0) ? 1.0 + (burst - 1.0) * 0.3 : 1.0;
  float ql = lumaQ(u, v)   * u_qLumaScale   * burst * jitter * highFreqPenalty;
  float qc = chromaQ(u, v) * u_qChromaScale * burst * jitter * highFreqPenalty;
  ql = max(1.0, ql);
  qc = max(1.0, qc);

  vec3 coef = texelFetch(u_input, ivec2(xo, yo), 0).rgb;
  vec3 q = vec3(ql, qc, qc);
  coef = floor(coef / q + 0.5) * q;

  // High-frequency dropout: probabilistic zero-out for burst > 3.
  if (i > 14 && burst > 3.0) {
    float drop = hash1(vec2(xo, yo), u_frameSeed + 97.0);
    if (drop < 0.15) coef = vec3(0.0);
  }

  fragColor = vec4(coef, 1.0);
}
`;

// --- Pass 5: column IDCT (transpose of DCT_COL). ---
const IDCT_COL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
${DCT_HELPER}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo = int(floor(px.y));
  int by = yo / 8;
  int y  = yo - by * 8;
  vec3 sum = vec3(0.0);
  for (int v = 0; v < 8; v++) {
    int sy = by * 8 + v;
    if (sy >= int(u_res.y)) break;
    sum += dctBasis(v, y) * texelFetch(u_input, ivec2(xo, sy), 0).rgb;
  }
  fragColor = vec4(sum, 1.0);
}
`;

// --- Pass 6: row IDCT, yields reconstructed YCbCr (with 128 bias to undo). ---
const IDCT_ROW_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
${DCT_HELPER}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo = int(floor(px.y));
  int bx = xo / 8;
  int x  = xo - bx * 8;
  vec3 sum = vec3(0.0);
  for (int u = 0; u < 8; u++) {
    int sx = bx * 8 + u;
    if (sx >= int(u_res.x)) break;
    sum += texelFetch(u_input, ivec2(sx, yo), 0).rgb * dctBasis(u, x);
  }
  // Undo the 128-offset we applied at DCT time; clamp to valid YCbCr range.
  fragColor = vec4(clamp(sum + vec3(128.0), 0.0, 255.0), 1.0);
}
`;

// --- Pass 7: post-process (deblock, ringing, mosquito) + YCbCr→RGB. ---
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_plane;   // reconstructed YCbCr in RGB channels
uniform sampler2D u_source;  // original source (for alpha passthrough)
uniform vec2  u_res;
uniform float u_deblock;
uniform float u_ringing;
uniform float u_mosquito;
uniform float u_mosquitoSeed;
uniform int   u_preserveAlpha;

float hash1(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

vec3 sampleP(int x, int y) {
  x = clamp(x, 0, int(u_res.x) - 1);
  y = clamp(y, 0, int(u_res.y) - 1);
  return texelFetch(u_plane, ivec2(x, y), 0).rgb;
}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo = int(floor(px.y));

  vec3 c = sampleP(xo, yo);

  // Deblock — soften seams at 8-pixel boundaries when |a-b| < 48.
  // Y uses full deblock strength, Cb/Cr use 0.8×.
  if (u_deblock > 0.0) {
    vec3 blend = vec3(u_deblock, u_deblock * 0.8, u_deblock * 0.8) * 0.5;
    // Horizontal seam — pixel is either just-after (xo%8==0) or just-before.
    int mod8x = xo - (xo / 8) * 8;
    if (mod8x == 0 && xo > 0) {
      vec3 other = sampleP(xo - 1, yo);
      vec3 diff = abs(c - other);
      vec3 mask = step(diff, vec3(48.0));
      vec3 mid = (c + other) * 0.5;
      c = mix(c, c + (mid - c) * blend, mask);
    } else if (mod8x == 7 && xo < int(u_res.x) - 1) {
      vec3 other = sampleP(xo + 1, yo);
      vec3 diff = abs(c - other);
      vec3 mask = step(diff, vec3(48.0));
      vec3 mid = (c + other) * 0.5;
      c = mix(c, c + (mid - c) * blend, mask);
    }
    int mod8y = yo - (yo / 8) * 8;
    if (mod8y == 0 && yo > 0) {
      vec3 other = sampleP(xo, yo - 1);
      vec3 diff = abs(c - other);
      vec3 mask = step(diff, vec3(48.0));
      vec3 mid = (c + other) * 0.5;
      c = mix(c, c + (mid - c) * blend, mask);
    } else if (mod8y == 7 && yo < int(u_res.y) - 1) {
      vec3 other = sampleP(xo, yo + 1);
      vec3 diff = abs(c - other);
      vec3 mask = step(diff, vec3(48.0));
      vec3 mid = (c + other) * 0.5;
      c = mix(c, c + (mid - c) * blend, mask);
    }
  }

  // Ringing — Y-channel Laplacian sharpen.
  if (u_ringing > 0.0 && xo > 0 && yo > 0 && xo < int(u_res.x) - 1 && yo < int(u_res.y) - 1) {
    float yy = c.r;
    float lap = sampleP(xo - 1, yo).r + sampleP(xo + 1, yo).r
              + sampleP(xo, yo - 1).r + sampleP(xo, yo + 1).r - 4.0 * yy;
    c.r = clamp(yy - lap * u_ringing * 0.35, 0.0, 255.0);
  }

  // Mosquito — edge-gated luma/chroma noise.
  if (u_mosquito > 0.0 && xo > 0 && yo > 0 && xo < int(u_res.x) - 1 && yo < int(u_res.y) - 1) {
    float yy = c.r;
    float g = abs(yy - sampleP(xo + 1, yo).r) + abs(yy - sampleP(xo, yo + 1).r);
    if (g > 30.0) {
      float n = (hash1(vec2(xo, yo), u_mosquitoSeed) - 0.5) * u_mosquito * 20.0;
      c.r = clamp(c.r + n, 0.0, 255.0);
      c.g = clamp(c.g + n * 0.8, 0.0, 255.0);
      c.b = clamp(c.b - n * 0.6, 0.0, 255.0);
    }
  }

  // YCbCr → RGB.
  float yv = c.r;
  float cb = c.g - 128.0;
  float cr = c.b - 128.0;
  float r = clamp(yv + 1.402 * cr, 0.0, 255.0);
  float gCh = clamp(yv - 0.344136 * cb - 0.714136 * cr, 0.0, 255.0);
  float b = clamp(yv + 1.772 * cb, 0.0, 255.0);

  float a = u_preserveAlpha == 1 ? texture(u_source, v_uv).a : 1.0;
  fragColor = vec4(r / 255.0, gCh / 255.0, b / 255.0, a);
}
`;

type Cache = {
  toYcbcr: Program;
  dctRow: Program;
  dctCol: Program;
  quant: Program;
  idctCol: Program;
  idctRow: Program;
  composite: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    toYcbcr: linkProgram(gl, TO_YCBCR_FS, ["u_source", "u_sourceRes", "u_subsampling"] as const),
    dctRow: linkProgram(gl, DCT_ROW_FS, ["u_input", "u_res"] as const),
    dctCol: linkProgram(gl, DCT_COL_FS, ["u_input", "u_res"] as const),
    quant: linkProgram(gl, QUANTISE_FS, [
      "u_input", "u_res", "u_qLumaScale", "u_qChromaScale",
      "u_gridJitter", "u_corruptBurstChance", "u_frameSeed",
    ] as const),
    idctCol: linkProgram(gl, IDCT_COL_FS, ["u_input", "u_res"] as const),
    idctRow: linkProgram(gl, IDCT_ROW_FS, ["u_input", "u_res"] as const),
    composite: linkProgram(gl, COMPOSITE_FS, [
      "u_plane", "u_source", "u_res", "u_deblock", "u_ringing",
      "u_mosquito", "u_mosquitoSeed", "u_preserveAlpha",
    ] as const),
  };
  return _cache;
};

// Intermediate float textures. RGBA32F is needed because DCT coefficients can
// exceed [0,255] and can be negative. Check the extension once and cache.
let _floatSupported: boolean | null = null;
const floatSupported = (gl: WebGL2RenderingContext): boolean => {
  if (_floatSupported !== null) return _floatSupported;
  _floatSupported = !!gl.getExtension("EXT_color_buffer_float");
  return _floatSupported;
};

type JpegFloatTexture = {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
};
const JPEG_FLOAT_CACHE_PREFIX = "__jpegFloat:";

export const ensureJpegFloatTexture = (
  gl: WebGL2RenderingContext,
  name: string,
  w: number,
  h: number,
): JpegFloatTexture | null => {
  // We use a local cache for RGBA32F textures because the shared ensureTexture
  // creates RGBA8. One texture per unique name; resized on width/height change.
  const key = `${JPEG_FLOAT_CACHE_PREFIX}${name}`;
  const store = gl as unknown as Record<string, unknown>;
  const cached = store[key] as JpegFloatTexture | undefined;
  if (cached && cached.w === w && cached.h === h) return cached;

  // Invalidate first: if replacement fails, no deleted handle may remain
  // discoverable as a valid cache hit on the next call.
  if (cached) {
    delete store[key];
    gl.deleteTexture(cached.tex);
    gl.deleteFramebuffer(cached.fbo);
  }

  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  const cleanup = () => {
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
  };
  if (!tex || !fbo) {
    cleanup();
    return null;
  }

  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    // Extension advertisement is not sufficient on every WebGL2 stack; only
    // publish the replacement after the exact RGBA32F FBO is complete.
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      cleanup();
      return null;
    }
    const entry = { tex, fbo, w, h };
    store[key] = entry;
    return entry;
  } catch {
    cleanup();
    return null;
  }
};

export const releaseJpegFloatTexturesForContext = (
  gl: WebGL2RenderingContext,
): number => {
  const store = gl as unknown as Record<string, unknown>;
  let released = 0;
  for (const key of Object.keys(store)) {
    if (!key.startsWith(JPEG_FLOAT_CACHE_PREFIX)) continue;
    const entry = store[key] as JpegFloatTexture | undefined;
    // Invalidate before deletion so repeated disposal and allocation failure
    // can never rediscover handles whose GL lifetime has ended.
    delete store[key];
    if (!entry) continue;
    gl.deleteTexture(entry.tex);
    gl.deleteFramebuffer(entry.fbo);
    released += 1;
  }
  return released;
};

export const getJpegFloatTextureCountForContext = (
  gl: WebGL2RenderingContext,
): number => Object.keys(gl as unknown as Record<string, unknown>)
  .filter((key) => key.startsWith(JPEG_FLOAT_CACHE_PREFIX)).length;

export const releaseJpegArtifactFloatTextures = (): number => {
  const ctx = getExistingGLCtx();
  return ctx ? releaseJpegFloatTexturesForContext(ctx.gl) : 0;
};

export const getJpegArtifactFloatTextureCount = (): number => {
  const ctx = getExistingGLCtx();
  return ctx ? getJpegFloatTextureCountForContext(ctx.gl) : 0;
};

export const jpegArtifactGLAvailable = (): boolean => {
  const ctx = getGLCtx();
  return glAvailable() && !!ctx && floatSupported(ctx.gl);
};

export const renderJpegArtifactGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  qualityLumaScale: number,
  qualityChromaScale: number,
  subsampling: "444" | "422" | "420",
  gridJitter: number,
  corruptBurstChance: number,
  deblock: number,
  ringing: number,
  mosquito: number,
  frameIndex: number,
  preserveAlpha: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  if (!floatSupported(gl)) return null;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "jpegArtifact:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const paddedWidth = Math.ceil(width / 8) * 8;
  const paddedHeight = Math.ceil(height / 8) * 8;
  const ycbcr = ensureJpegFloatTexture(gl, "ycbcr", paddedWidth, paddedHeight);
  const dct1 = ensureJpegFloatTexture(gl, "dct1", paddedWidth, paddedHeight);
  const dct2 = ensureJpegFloatTexture(gl, "dct2", paddedWidth, paddedHeight);
  const quant = ensureJpegFloatTexture(gl, "quant", paddedWidth, paddedHeight);
  const idct1 = ensureJpegFloatTexture(gl, "idct1", paddedWidth, paddedHeight);
  const idct2 = ensureJpegFloatTexture(gl, "idct2", paddedWidth, paddedHeight);
  if (!ycbcr || !dct1 || !dct2 || !quant || !idct1 || !idct2) return null;

  // drawPass expects { tex, fbo } shape to match its TexEntry type; our float
  // entries are compatible.
  const asEntry = (e: { tex: WebGLTexture; fbo: WebGLFramebuffer }) =>
    ({ tex: e.tex, fbo: e.fbo, w: paddedWidth, h: paddedHeight });

  drawPass(gl, asEntry(ycbcr), paddedWidth, paddedHeight, cache.toYcbcr, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.toYcbcr.uniforms.u_source, 0);
    gl.uniform2f(cache.toYcbcr.uniforms.u_sourceRes, width, height);
    gl.uniform1i(cache.toYcbcr.uniforms.u_subsampling, subsampling === "444" ? 0 : subsampling === "422" ? 1 : 2);
  }, vao);

  drawPass(gl, asEntry(dct1), paddedWidth, paddedHeight, cache.dctRow, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ycbcr.tex);
    gl.uniform1i(cache.dctRow.uniforms.u_input, 0);
    gl.uniform2f(cache.dctRow.uniforms.u_res, paddedWidth, paddedHeight);
  }, vao);

  drawPass(gl, asEntry(dct2), paddedWidth, paddedHeight, cache.dctCol, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dct1.tex);
    gl.uniform1i(cache.dctCol.uniforms.u_input, 0);
    gl.uniform2f(cache.dctCol.uniforms.u_res, paddedWidth, paddedHeight);
  }, vao);

  drawPass(gl, asEntry(quant), paddedWidth, paddedHeight, cache.quant, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dct2.tex);
    gl.uniform1i(cache.quant.uniforms.u_input, 0);
    gl.uniform2f(cache.quant.uniforms.u_res, paddedWidth, paddedHeight);
    gl.uniform1f(cache.quant.uniforms.u_qLumaScale, qualityLumaScale);
    gl.uniform1f(cache.quant.uniforms.u_qChromaScale, qualityChromaScale);
    gl.uniform1f(cache.quant.uniforms.u_gridJitter, gridJitter);
    gl.uniform1f(cache.quant.uniforms.u_corruptBurstChance, corruptBurstChance);
    gl.uniform1f(cache.quant.uniforms.u_frameSeed, frameIndex);
  }, vao);

  drawPass(gl, asEntry(idct1), paddedWidth, paddedHeight, cache.idctCol, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, quant.tex);
    gl.uniform1i(cache.idctCol.uniforms.u_input, 0);
    gl.uniform2f(cache.idctCol.uniforms.u_res, paddedWidth, paddedHeight);
  }, vao);

  drawPass(gl, asEntry(idct2), paddedWidth, paddedHeight, cache.idctRow, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, idct1.tex);
    gl.uniform1i(cache.idctRow.uniforms.u_input, 0);
    gl.uniform2f(cache.idctRow.uniforms.u_res, paddedWidth, paddedHeight);
  }, vao);

  drawPass(gl, null, width, height, cache.composite, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, idct2.tex);
    gl.uniform1i(cache.composite.uniforms.u_plane, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_source, 1);
    gl.uniform2f(cache.composite.uniforms.u_res, width, height);
    gl.uniform1f(cache.composite.uniforms.u_deblock, deblock);
    gl.uniform1f(cache.composite.uniforms.u_ringing, ringing);
    gl.uniform1f(cache.composite.uniforms.u_mosquito, mosquito);
    gl.uniform1f(cache.composite.uniforms.u_mosquitoSeed, frameIndex + 1);
    gl.uniform1i(cache.composite.uniforms.u_preserveAlpha, preserveAlpha ? 1 : 0);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
