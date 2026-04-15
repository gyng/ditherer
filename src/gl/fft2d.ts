// Shared 2D FFT on the GPU, used by the `fft*` filter family.
//
// Implementation: Cooley-Tukey radix-2 DIT. For a padded pow-2 canvas,
// run bit-reverse permute along rows → log2(W) row butterflies → bit-reverse
// permute along columns → log2(H) column butterflies. Inverse reverses the
// twiddle sign and divides by N at the end.
//
// Storage: RGBA32F. RG holds the complex value (R=real, G=imag) for the
// luminance channel of the source. BA are reserved for a future per-channel
// RGB extension; the current filters operate on luminance only and
// reconstruct colour by scaling input RGB by the luminance ratio.
//
// Availability gate: needs `EXT_color_buffer_float`. Every filter that
// consumes this module must fall through to a CPU/approximation path when
// the extension is missing.

import {
  drawPass,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  type Program,
  type TexEntry,
} from "./index";

export const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

export const log2Int = (n: number): number => {
  let l = 0;
  while ((1 << l) < n) l++;
  return l;
};

// --- Luminance extract + pad. Source is uploaded with UNPACK_FLIP_Y, so
// we sample in JS-y space. Output is a complex image (R=lum, G=0, BA=0) in
// an RGBA32F texture of size paddedW × paddedH. Out-of-bounds texels are 0.
const EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_srcRes;
uniform vec2  u_padRes;

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  if (x >= u_srcRes.x || y >= u_srcRes.y) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 suv = vec2((x + 0.5) / u_srcRes.x, 1.0 - (y + 0.5) / u_srcRes.y);
  vec3 c = texture(u_source, suv).rgb;
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  fragColor = vec4(lum, 0.0, 0.0, 1.0);
}
`;

// --- Bit-reverse permutation along one axis. For every output texel at
// axial index k, read from input at bitReverse(k, logN). Used once per
// axis before the butterfly passes.
const BIT_REVERSE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_axis;   // 0 rows, 1 cols
uniform int   u_logN;

int bitReverse(int v, int bits) {
  int r = 0;
  for (int b = 0; b < 16; b++) {
    if (b >= bits) break;
    if ((v & (1 << b)) != 0) r = r | (1 << (bits - 1 - b));
  }
  return r;
}

void main() {
  vec2 px = v_uv * u_res;
  int x = int(floor(px.x));
  int y = int(floor(px.y));
  if (u_axis == 0) x = bitReverse(x, u_logN);
  else             y = bitReverse(y, u_logN);
  fragColor = texelFetch(u_input, ivec2(x, y), 0);
}
`;

// --- Butterfly pass. Stage s has m = 2^s, halfM = 2^(s-1). For output
// index k (along the active axis):
//   posInGroup = k mod m
//   if posInGroup < halfM:  j = posInGroup;      a = in[k];         b = in[k+halfM]; out = a + w·b
//   else:                   j = posInGroup-halfM; a = in[k-halfM];  b = in[k];        out = a - w·b
// w = exp(sign · i · 2π · j / m). sign = -1 for forward, +1 for inverse.
const BUTTERFLY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_axis;
uniform int   u_m;
uniform int   u_halfM;
uniform float u_sign;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

void main() {
  vec2 px = v_uv * u_res;
  int x = int(floor(px.x));
  int y = int(floor(px.y));
  int k = u_axis == 0 ? x : y;

  int grp = k / u_m;
  int pos = k - grp * u_m;
  bool topHalf = pos < u_halfM;
  int j = topHalf ? pos : pos - u_halfM;
  float angle = u_sign * 2.0 * 3.14159265 * float(j) / float(u_m);
  vec2 w = vec2(cos(angle), sin(angle));

  ivec2 kIdx, pIdx;
  if (u_axis == 0) {
    if (topHalf) { kIdx = ivec2(k, y); pIdx = ivec2(k + u_halfM, y); }
    else         { kIdx = ivec2(k - u_halfM, y); pIdx = ivec2(k, y); }
  } else {
    if (topHalf) { kIdx = ivec2(x, k); pIdx = ivec2(x, k + u_halfM); }
    else         { kIdx = ivec2(x, k - u_halfM); pIdx = ivec2(x, k); }
  }

  vec2 a = texelFetch(u_input, kIdx, 0).rg;
  vec2 b = texelFetch(u_input, pIdx, 0).rg;
  vec2 result = topHalf ? a + cmul(w, b) : a - cmul(w, b);
  fragColor = vec4(result, 0.0, 1.0);
}
`;

// --- Inverse-FFT final normalisation (divide by N = paddedW × paddedH) +
// crop back to original resolution, producing an R8 output suitable for
// consumption as a filter result. Also optionally re-scales the original
// source RGB by (outputLum / inputLum) to preserve colour.
const INV_FINALISE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;        // RG = complex luminance after IFFT stages
uniform sampler2D u_source;
uniform vec2  u_srcRes;
uniform vec2  u_padRes;
uniform float u_invN;

void main() {
  vec2 px = v_uv * u_srcRes;
  float x = floor(px.x);
  float y = u_srcRes.y - 1.0 - floor(px.y);

  // The FFT lives in a paddedW × paddedH RGBA32F texture. The
  // reconstructed image occupies the top-left (srcW × srcH) region, zeros
  // elsewhere (the padding we added on forward extract). Sample that sub-
  // region using padded UVs so the crop is 1:1.
  vec2 padUV = vec2((x + 0.5) / u_padRes.x, (y + 0.5) / u_padRes.y);
  float outLum = texture(u_fft, padUV).r * u_invN;

  // Original colour at this pixel.
  vec2 suv = vec2((x + 0.5) / u_srcRes.x, 1.0 - (y + 0.5) / u_srcRes.y);
  vec3 src = texture(u_source, suv).rgb;
  float inLum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;

  // Scale RGB by the luminance ratio to preserve hue. Guard divide-by-zero
  // with a small epsilon + fall back to neutral grey for truly-black pixels.
  float ratio = inLum > 1e-4 ? outLum / inLum : outLum;
  vec3 rgb = clamp(src * ratio, 0.0, 1.0);
  fragColor = vec4(rgb, 1.0);
}
`;

type FFTCache = {
  extract: Program;
  bitrev: Program;
  butterfly: Program;
  finalise: Program;
};
let _cache: FFTCache | null = null;

const initCache = (gl: WebGL2RenderingContext): FFTCache => {
  if (_cache) return _cache;
  _cache = {
    extract: linkProgram(gl, EXTRACT_FS, ["u_source", "u_srcRes", "u_padRes"] as const),
    bitrev: linkProgram(gl, BIT_REVERSE_FS, ["u_input", "u_res", "u_axis", "u_logN"] as const),
    butterfly: linkProgram(gl, BUTTERFLY_FS, [
      "u_input", "u_res", "u_axis", "u_m", "u_halfM", "u_sign",
    ] as const),
    finalise: linkProgram(gl, INV_FINALISE_FS, [
      "u_fft", "u_source", "u_srcRes", "u_padRes", "u_invN",
    ] as const),
  };
  return _cache;
};

// Float texture pool keyed by name. RGBA32F format matching the FFT
// pipeline convention (RG = complex, BA unused). Not part of the shared
// RGBA8 pool in index.ts — the shared pool assumes RGBA8.
type FloatEntry = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };
const _floatPool: Record<string, FloatEntry> = {};

export const ensureFloatTex = (
  gl: WebGL2RenderingContext,
  name: string,
  w: number,
  h: number,
): FloatEntry | null => {
  const cached = _floatPool[name];
  if (cached && cached.w === w && cached.h === h) return cached;
  if (cached) {
    gl.deleteTexture(cached.tex);
    gl.deleteFramebuffer(cached.fbo);
  }
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  const entry = { tex, fbo, w, h };
  _floatPool[name] = entry;
  return entry;
};

let _floatSupported: boolean | null = null;
export const fft2dAvailable = (): boolean => {
  const ctx = getGLCtx();
  if (!ctx) return false;
  if (_floatSupported !== null) return _floatSupported;
  _floatSupported = !!ctx.gl.getExtension("EXT_color_buffer_float");
  return _floatSupported;
};

export type FFTResult = {
  /** Texture containing the padded frequency-domain data (RG=complex). */
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  /** Padded width/height (power of 2). */
  paddedW: number;
  paddedH: number;
  /** Original (pre-padding) width/height. */
  srcW: number;
  srcH: number;
  /** log2 of the padded dims. */
  logW: number;
  logH: number;
};

// Run a forward 2D FFT on the luminance of the source canvas. The result is
// an RG32F texture of padded size (power of two in each dim). The complex
// samples are stored with R=real, G=imag; DC bin at (0, 0), top-left.
export const forwardFFT2D = (
  gl: WebGL2RenderingContext,
  sourceTex: TexEntry,
  srcW: number,
  srcH: number,
): FFTResult | null => {
  if (!fft2dAvailable()) return null;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const paddedW = nextPow2(srcW);
  const paddedH = nextPow2(srcH);
  const logW = log2Int(paddedW);
  const logH = log2Int(paddedH);

  // Ping-pong pair of float textures, both at (paddedW × paddedH).
  const pingA = ensureFloatTex(gl, "fft2d:ping", paddedW, paddedH);
  const pingB = ensureFloatTex(gl, "fft2d:pong", paddedW, paddedH);
  if (!pingA || !pingB) return null;

  // 1. Extract luminance → pingA.
  drawPass(gl, pingA, paddedW, paddedH, cache.extract, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.extract.uniforms.u_source, 0);
    gl.uniform2f(cache.extract.uniforms.u_srcRes, srcW, srcH);
    gl.uniform2f(cache.extract.uniforms.u_padRes, paddedW, paddedH);
  }, vao);

  let src = pingA;
  let dst = pingB;

  // 2. Bit-reverse along rows.
  drawPass(gl, dst, paddedW, paddedH, cache.bitrev, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(cache.bitrev.uniforms.u_input, 0);
    gl.uniform2f(cache.bitrev.uniforms.u_res, paddedW, paddedH);
    gl.uniform1i(cache.bitrev.uniforms.u_axis, 0);
    gl.uniform1i(cache.bitrev.uniforms.u_logN, logW);
  }, vao);
  [src, dst] = [dst, src];

  // 3. Row butterflies.
  for (let s = 1; s <= logW; s++) {
    const m = 1 << s;
    const halfM = m >> 1;
    drawPass(gl, dst, paddedW, paddedH, cache.butterfly, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(cache.butterfly.uniforms.u_input, 0);
      gl.uniform2f(cache.butterfly.uniforms.u_res, paddedW, paddedH);
      gl.uniform1i(cache.butterfly.uniforms.u_axis, 0);
      gl.uniform1i(cache.butterfly.uniforms.u_m, m);
      gl.uniform1i(cache.butterfly.uniforms.u_halfM, halfM);
      gl.uniform1f(cache.butterfly.uniforms.u_sign, -1);
    }, vao);
    [src, dst] = [dst, src];
  }

  // 4. Bit-reverse along columns.
  drawPass(gl, dst, paddedW, paddedH, cache.bitrev, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(cache.bitrev.uniforms.u_input, 0);
    gl.uniform2f(cache.bitrev.uniforms.u_res, paddedW, paddedH);
    gl.uniform1i(cache.bitrev.uniforms.u_axis, 1);
    gl.uniform1i(cache.bitrev.uniforms.u_logN, logH);
  }, vao);
  [src, dst] = [dst, src];

  // 5. Column butterflies.
  for (let s = 1; s <= logH; s++) {
    const m = 1 << s;
    const halfM = m >> 1;
    drawPass(gl, dst, paddedW, paddedH, cache.butterfly, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(cache.butterfly.uniforms.u_input, 0);
      gl.uniform2f(cache.butterfly.uniforms.u_res, paddedW, paddedH);
      gl.uniform1i(cache.butterfly.uniforms.u_axis, 1);
      gl.uniform1i(cache.butterfly.uniforms.u_m, m);
      gl.uniform1i(cache.butterfly.uniforms.u_halfM, halfM);
      gl.uniform1f(cache.butterfly.uniforms.u_sign, -1);
    }, vao);
    [src, dst] = [dst, src];
  }

  return {
    tex: src.tex, fbo: src.fbo,
    paddedW, paddedH, srcW, srcH, logW, logH,
  };
};

// Run an inverse 2D FFT on a frequency-domain texture (RG=complex, padded
// to pow2). Writes the real part of the result back into a W×H texture
// passed by the caller — used by filters that need to composite against
// the original RGB. The result still needs to be normalised by 1/N; the
// `finaliseIFFT` helper does that at the crop step.
export const inverseFFT2D = (
  gl: WebGL2RenderingContext,
  input: { tex: WebGLTexture; fbo: WebGLFramebuffer },
  paddedW: number,
  paddedH: number,
  logW: number,
  logH: number,
): FloatEntry | null => {
  if (!fft2dAvailable()) return null;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  // Ping-pong pool. The first pass (bit-reverse rows) reads the caller's
  // input texture; all subsequent passes alternate between pingA/pingB.
  const pingA = ensureFloatTex(gl, "fft2d:ping", paddedW, paddedH);
  const pingB = ensureFloatTex(gl, "fft2d:pong", paddedW, paddedH);
  if (!pingA || !pingB) return null;

  drawPass(gl, pingA, paddedW, paddedH, cache.bitrev, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.tex);
    gl.uniform1i(cache.bitrev.uniforms.u_input, 0);
    gl.uniform2f(cache.bitrev.uniforms.u_res, paddedW, paddedH);
    gl.uniform1i(cache.bitrev.uniforms.u_axis, 0);
    gl.uniform1i(cache.bitrev.uniforms.u_logN, logW);
  }, vao);

  let src = pingA;
  let dst = pingB;

  // Row butterflies (inverse sign).
  for (let s = 1; s <= logW; s++) {
    const m = 1 << s;
    const halfM = m >> 1;
    drawPass(gl, dst, paddedW, paddedH, cache.butterfly, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(cache.butterfly.uniforms.u_input, 0);
      gl.uniform2f(cache.butterfly.uniforms.u_res, paddedW, paddedH);
      gl.uniform1i(cache.butterfly.uniforms.u_axis, 0);
      gl.uniform1i(cache.butterfly.uniforms.u_m, m);
      gl.uniform1i(cache.butterfly.uniforms.u_halfM, halfM);
      gl.uniform1f(cache.butterfly.uniforms.u_sign, 1);
    }, vao);
    [src, dst] = [dst, src];
  }

  drawPass(gl, dst, paddedW, paddedH, cache.bitrev, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(cache.bitrev.uniforms.u_input, 0);
    gl.uniform2f(cache.bitrev.uniforms.u_res, paddedW, paddedH);
    gl.uniform1i(cache.bitrev.uniforms.u_axis, 1);
    gl.uniform1i(cache.bitrev.uniforms.u_logN, logH);
  }, vao);
  [src, dst] = [dst, src];

  for (let s = 1; s <= logH; s++) {
    const m = 1 << s;
    const halfM = m >> 1;
    drawPass(gl, dst, paddedW, paddedH, cache.butterfly, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(cache.butterfly.uniforms.u_input, 0);
      gl.uniform2f(cache.butterfly.uniforms.u_res, paddedW, paddedH);
      gl.uniform1i(cache.butterfly.uniforms.u_axis, 1);
      gl.uniform1i(cache.butterfly.uniforms.u_m, m);
      gl.uniform1i(cache.butterfly.uniforms.u_halfM, halfM);
      gl.uniform1f(cache.butterfly.uniforms.u_sign, 1);
    }, vao);
    [src, dst] = [dst, src];
  }

  return src;
};

// Finalise an IFFT result — divide by N and composite against the source
// RGB (preserving hue) into the GL canvas at srcW × srcH. Caller should
// call `readoutToCanvas` after this.
export const finaliseIFFT = (
  gl: WebGL2RenderingContext,
  ifftResult: FloatEntry,
  sourceTex: TexEntry,
  srcW: number,
  srcH: number,
  paddedW: number,
  paddedH: number,
  targetCanvasW: number,
  targetCanvasH: number,
): void => {
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  const invN = 1 / (paddedW * paddedH);

  drawPass(gl, null, targetCanvasW, targetCanvasH, cache.finalise, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ifftResult.tex);
    gl.uniform1i(cache.finalise.uniforms.u_fft, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.finalise.uniforms.u_source, 1);
    gl.uniform2f(cache.finalise.uniforms.u_srcRes, srcW, srcH);
    gl.uniform2f(cache.finalise.uniforms.u_padRes, paddedW, paddedH);
    gl.uniform1f(cache.finalise.uniforms.u_invN, invN);
  }, vao);
};
