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

// CRC stripe/tile rejection. For each output pixel, identify the region
// (stripe or tile) it belongs to, hash(region, frameSeed) against rejectChance
// to decide if this region fails CRC. If rejected, apply one of four
// concealment strategies: black, hold prev frame, copy previous row, or copy
// from the nearest valid edge. The JS path uses a mulberry32 stream; here we
// use per-region hashes for shift parity — visually equivalent.
const CRC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prevOutput;
uniform int   u_hasPrev;

uniform vec2  u_res;
uniform int   u_pattern;          // 0 stripe, 1 tile
uniform int   u_stripeHeight;
uniform int   u_tileSize;
uniform float u_rejectChance;
uniform int   u_jitter;
uniform int   u_conceal;          // 0 BLACK, 1 HOLD, 2 PREV_ROW, 3 NEAREST_VALID
uniform float u_frameSeed;
uniform float u_levels;

float hash1(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

vec2 jsUV(int x, int y_js) {
  return vec2((float(x) + 0.5) / u_res.x, 1.0 - (float(y_js) + 0.5) / u_res.y);
}

vec4 sampleSrc(int x, int y_js) {
  int cx = clamp(x, 0, int(u_res.x) - 1);
  int cy = clamp(y_js, 0, int(u_res.y) - 1);
  return texture(u_source, jsUV(cx, cy));
}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo_js = int(u_res.y) - 1 - int(floor(px.y));
  int W = int(u_res.x);
  int H = int(u_res.y);

  // By default the pixel is a passthrough of source.
  vec4 color = sampleSrc(xo, yo_js);
  bool rejected = false;
  int x0 = 0, y0 = 0, x1 = 0, y1 = 0;

  if (u_pattern == 0) {
    // Stripe: determine baseY = floor(yo_js / band) * band, hash(baseY), add
    // jitter offset, clamp. Pixel is rejected if its row falls into the
    // jittered stripe AND the stripe's hash rolls below rejectChance.
    int band = max(1, u_stripeHeight);
    // Iterate the stripes that can overlap this pixel (at most one without
    // jitter, possibly two with jitter). Worst case: ±u_jitter overlap.
    // Checking the current-row stripe + neighbours keeps it bounded.
    for (int k = -1; k <= 1; k++) {
      int baseY = ((yo_js / band) + k) * band;
      if (baseY < -band || baseY >= H) continue;
      float r1 = hash1(vec2(float(baseY), 0.0), u_frameSeed);
      if (r1 >= u_rejectChance) continue;
      int offset = 0;
      if (u_jitter > 0) {
        float r2 = hash1(vec2(float(baseY), 1.0), u_frameSeed) * 2.0 - 1.0;
        offset = int(floor(r2 * float(u_jitter) + 0.5));
      }
      int syStart = clamp(baseY + offset, 0, H - 1);
      int syEnd = min(H, syStart + band);
      if (yo_js >= syStart && yo_js < syEnd) {
        rejected = true;
        x0 = 0; y0 = syStart; x1 = W; y1 = syEnd;
        break;
      }
    }
  } else {
    int cell = max(2, u_tileSize);
    // Same idea for tiles — iterate current + immediate neighbours.
    for (int kj = -1; kj <= 1; kj++) {
      for (int ki = -1; ki <= 1; ki++) {
        int baseY = ((yo_js / cell) + kj) * cell;
        int baseX = ((xo / cell) + ki) * cell;
        if (baseX < -cell || baseX >= W || baseY < -cell || baseY >= H) continue;
        float r1 = hash1(vec2(float(baseX), float(baseY)), u_frameSeed);
        if (r1 >= u_rejectChance) continue;
        int jx = 0, jy = 0;
        if (u_jitter > 0) {
          float rx = hash1(vec2(float(baseX), float(baseY) + 1.0), u_frameSeed) * 2.0 - 1.0;
          float ry = hash1(vec2(float(baseX), float(baseY) + 2.0), u_frameSeed) * 2.0 - 1.0;
          jx = int(floor(rx * float(u_jitter) + 0.5));
          jy = int(floor(ry * float(u_jitter) + 0.5));
        }
        int sxStart = clamp(baseX + jx, 0, W - 1);
        int syStart = clamp(baseY + jy, 0, H - 1);
        int sxEnd = min(W, sxStart + cell);
        int syEnd = min(H, syStart + cell);
        if (xo >= sxStart && xo < sxEnd && yo_js >= syStart && yo_js < syEnd) {
          rejected = true;
          x0 = sxStart; y0 = syStart; x1 = sxEnd; y1 = syEnd;
          break;
        }
      }
      if (rejected) break;
    }
  }

  if (rejected) {
    if (u_conceal == 0) {
      color = vec4(0.0, 0.0, 0.0, 1.0);
    } else if (u_conceal == 1 && u_hasPrev == 1) {
      color = texture(u_prevOutput, jsUV(xo, yo_js));
    } else if (u_conceal == 2) {
      int sy = max(0, yo_js - 1);
      color = sampleSrc(xo, sy);
    } else if (u_conceal == 3) {
      if (u_pattern == 0) {
        int sy = y0 > 0 ? y0 - 1 : min(H - 1, y1);
        color = sampleSrc(xo, sy);
      } else {
        int leftX  = x0 > 0 ? x0 - 1 : (x1 < W ? x1 : xo);
        int rightX = x1 < W ? x1 : (x0 > 0 ? x0 - 1 : xo);
        bool useLeft = abs(xo - leftX) <= abs(rightX - xo);
        int sx = useLeft ? leftX : rightX;
        color = sampleSrc(sx, yo_js);
      }
    } else {
      // Missing prevOutput in HOLD mode → fall back to black rather than the
      // source pixel (matches JS: writePixel(0,0,0) when prev isn't set).
      if (u_conceal == 1) color = vec4(0.0, 0.0, 0.0, 1.0);
    }
  }

  vec3 rgb = color.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, color.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, CRC_FS, [
      "u_source", "u_prevOutput", "u_hasPrev", "u_res",
      "u_pattern", "u_stripeHeight", "u_tileSize",
      "u_rejectChance", "u_jitter", "u_conceal",
      "u_frameSeed", "u_levels",
    ] as const),
  };
  return _cache;
};

export const crcStripeRejectGLAvailable = (): boolean => glAvailable();

// Upload a Uint8ClampedArray as RGBA8 texture with FLIP_Y disabled (caller
// delivers in memory-order RGBA matching the render-target convention).
const uploadPrev = (
  gl: WebGL2RenderingContext,
  data: Uint8ClampedArray,
  w: number,
  h: number,
): WebGLTexture | null => {
  if (data.byteLength !== w * h * 4) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return tex;
};

export const CRC_PATTERN_ID: Record<string, number> = { STRIPE: 0, TILE: 1 };
export const CRC_CONCEAL_ID: Record<string, number> = {
  BLACK: 0, HOLD: 1, PREV_ROW: 2, NEAREST_VALID: 3,
};

export const renderCrcStripeRejectGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  pattern: string,
  rejectChance: number,
  stripeHeight: number,
  tileSize: number,
  conceal: string,
  jitter: number,
  frameIndex: number,
  prevOutput: Uint8ClampedArray | null,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const patternId = CRC_PATTERN_ID[pattern];
  const concealId = CRC_CONCEAL_ID[conceal];
  if (patternId === undefined || concealId === undefined) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "crcStripeReject:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const prevTex = conceal === "HOLD" && prevOutput
    ? uploadPrev(gl, prevOutput, width, height)
    : null;

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    if (prevTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.uniform1i(cache.prog.uniforms.u_prevOutput, 1);
      gl.uniform1i(cache.prog.uniforms.u_hasPrev, 1);
    } else {
      gl.uniform1i(cache.prog.uniforms.u_hasPrev, 0);
    }
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_pattern, patternId);
    gl.uniform1i(cache.prog.uniforms.u_stripeHeight, Math.max(1, Math.round(stripeHeight)));
    gl.uniform1i(cache.prog.uniforms.u_tileSize, Math.max(2, Math.round(tileSize)));
    gl.uniform1f(cache.prog.uniforms.u_rejectChance, rejectChance);
    gl.uniform1i(cache.prog.uniforms.u_jitter, Math.max(0, Math.round(jitter)));
    gl.uniform1i(cache.prog.uniforms.u_conceal, concealId);
    gl.uniform1f(cache.prog.uniforms.u_frameSeed, frameIndex * 2851 + 17);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  const out = readoutToCanvas(canvas, width, height);
  if (prevTex) gl.deleteTexture(prevTex);
  return out;
};
