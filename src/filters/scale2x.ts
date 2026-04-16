import { ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
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

const ALGORITHM = { SCALE2X: "SCALE2X", EAGLE: "EAGLE", NEAREST: "NEAREST" };
const ALGO_ID: Record<string, number> = { SCALE2X: 0, EAGLE: 1, NEAREST: 2 };

export const optionTypes = {
  algorithm: { type: ENUM, options: [
    { name: "Scale2x", value: ALGORITHM.SCALE2X },
    { name: "Eagle", value: ALGORITHM.EAGLE },
    { name: "Nearest", value: ALGORITHM.NEAREST }
  ], default: ALGORITHM.SCALE2X, desc: "Pixel-art upscaling algorithm" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  algorithm: optionTypes.algorithm.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorsEqual = (buf: Uint8ClampedArray, i: number, j: number) =>
  buf[i] === buf[j] && buf[i+1] === buf[j+1] && buf[i+2] === buf[j+2];

const copyPixel = (outBuf: Uint8ClampedArray, di: number, srcBuf: Uint8ClampedArray, si: number) => {
  outBuf[di] = srcBuf[si]; outBuf[di+1] = srcBuf[si+1]; outBuf[di+2] = srcBuf[si+2]; outBuf[di+3] = srcBuf[si+3];
};

// Output is 2× input dims. For each output pixel, identify the input pixel
// and the quadrant (0..3), then apply Scale2x/Eagle rules by sampling
// neighbours in the input.
const UPSCALE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_inRes;     // source dims
uniform vec2  u_outRes;    // 2× source
uniform int   u_algo;      // 0 SCALE2X, 1 EAGLE, 2 NEAREST

vec4 samplePx(float x, float y) {
  float cx = clamp(floor(x), 0.0, u_inRes.x - 1.0);
  float cy = clamp(floor(y), 0.0, u_inRes.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_inRes.x, 1.0 - (cy + 0.5) / u_inRes.y);
  return texture(u_source, uv);
}

bool eq(vec4 a, vec4 b) {
  return a.r == b.r && a.g == b.g && a.b == b.b;
}

void main() {
  vec2 px = v_uv * u_outRes;
  float ox = floor(px.x);
  float oy = u_outRes.y - 1.0 - floor(px.y);

  float ix = floor(ox * 0.5);
  float iy = floor(oy * 0.5);
  int qx = int(mod(ox, 2.0));  // 0 = left, 1 = right
  int qy = int(mod(oy, 2.0));  // 0 = top, 1 = bottom

  vec4 P = samplePx(ix, iy);

  if (u_algo == 2) {
    fragColor = P;
    return;
  }

  if (u_algo == 0) {
    vec4 A = samplePx(ix, iy - 1.0);
    vec4 B = samplePx(ix - 1.0, iy);
    vec4 C = samplePx(ix + 1.0, iy);
    vec4 D = samplePx(ix, iy + 1.0);
    vec4 pick = P;
    if (qx == 0 && qy == 0) {
      if (eq(A, B) && !eq(A, C) && !eq(B, D)) pick = A;
    } else if (qx == 1 && qy == 0) {
      if (eq(A, C) && !eq(A, B) && !eq(C, D)) pick = A;
    } else if (qx == 0 && qy == 1) {
      if (eq(B, D) && !eq(A, B) && !eq(C, D)) pick = B;
    } else {
      if (eq(C, D) && !eq(A, C) && !eq(B, D)) pick = C;
    }
    fragColor = pick;
    return;
  }

  // EAGLE
  vec4 TL = samplePx(ix - 1.0, iy - 1.0);
  vec4 T  = samplePx(ix,       iy - 1.0);
  vec4 TR = samplePx(ix + 1.0, iy - 1.0);
  vec4 L  = samplePx(ix - 1.0, iy      );
  vec4 R  = samplePx(ix + 1.0, iy      );
  vec4 BL = samplePx(ix - 1.0, iy + 1.0);
  vec4 Bo = samplePx(ix,       iy + 1.0);
  vec4 BR = samplePx(ix + 1.0, iy + 1.0);
  vec4 pick = P;
  if (qx == 0 && qy == 0) { if (eq(T, L) && eq(T, TL)) pick = T; }
  else if (qx == 1 && qy == 0) { if (eq(T, R) && eq(T, TR)) pick = T; }
  else if (qx == 0 && qy == 1) { if (eq(Bo, L) && eq(Bo, BL)) pick = Bo; }
  else { if (eq(Bo, R) && eq(Bo, BR)) pick = Bo; }
  fragColor = pick;
}
`;

type Cache = { up: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    up: linkProgram(gl, UPSCALE_FS, [
      "u_source", "u_inRes", "u_outRes", "u_algo",
    ] as const),
  };
  return _cache;
};

const scale2x = (input: any, options = defaults) => {
  const { algorithm, palette } = options;
  const W = input.width, H = input.height;
  const oW = W * 2, oH = H * 2;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, oW, oH);
      const sourceTex = ensureTexture(gl, "scale2x:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, oW, oH, cache.up, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.up.uniforms.u_source, 0);
        gl.uniform2f(cache.up.uniforms.u_inRes, W, H);
        gl.uniform2f(cache.up.uniforms.u_outRes, oW, oH);
        gl.uniform1i(cache.up.uniforms.u_algo, ALGO_ID[algorithm] ?? 0);
      }, vao);

      const rendered = readoutToCanvas(canvas, oW, oH);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, oW, oH, palette);
        if (out) {
          logFilterBackend("Pixel Art Upscale", "WebGL2",
            `${algorithm}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Pixel Art Upscale", false, "fallback JS");
  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  const output = cloneCanvas(input, false);
  output.width = oW;
  output.height = oH;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const outBuf = new Uint8ClampedArray(oW * oH * 4);

  const getIdx = (x: number, y: number) => getBufferIndex(Math.max(0, Math.min(W-1, x)), Math.max(0, Math.min(H-1, y)), W);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const P = getIdx(x, y);
      const ox = x * 2, oy = y * 2;
      const d0 = (oy * oW + ox) * 4;
      const d1 = (oy * oW + ox + 1) * 4;
      const d2 = ((oy + 1) * oW + ox) * 4;
      const d3 = ((oy + 1) * oW + ox + 1) * 4;

      if (algorithm === ALGORITHM.NEAREST) {
        copyPixel(outBuf, d0, buf, P);
        copyPixel(outBuf, d1, buf, P);
        copyPixel(outBuf, d2, buf, P);
        copyPixel(outBuf, d3, buf, P);
      } else if (algorithm === ALGORITHM.SCALE2X) {
        const A = getIdx(x, y-1), B = getIdx(x-1, y), C = getIdx(x+1, y), D = getIdx(x, y+1);
        copyPixel(outBuf, d0, buf, colorsEqual(buf, A, B) && !colorsEqual(buf, A, C) && !colorsEqual(buf, B, D) ? A : P);
        copyPixel(outBuf, d1, buf, colorsEqual(buf, A, C) && !colorsEqual(buf, A, B) && !colorsEqual(buf, C, D) ? A : P);
        copyPixel(outBuf, d2, buf, colorsEqual(buf, B, D) && !colorsEqual(buf, A, B) && !colorsEqual(buf, C, D) ? B : P);
        copyPixel(outBuf, d3, buf, colorsEqual(buf, C, D) && !colorsEqual(buf, A, C) && !colorsEqual(buf, B, D) ? C : P);
      } else {
        const TL = getIdx(x-1, y-1), T = getIdx(x, y-1), TR = getIdx(x+1, y-1);
        const L = getIdx(x-1, y), R = getIdx(x+1, y);
        const BL = getIdx(x-1, y+1), Bo = getIdx(x, y+1), BR = getIdx(x+1, y+1);
        copyPixel(outBuf, d0, buf, colorsEqual(buf, T, L) && colorsEqual(buf, T, TL) ? T : P);
        copyPixel(outBuf, d1, buf, colorsEqual(buf, T, R) && colorsEqual(buf, T, TR) ? T : P);
        copyPixel(outBuf, d2, buf, colorsEqual(buf, Bo, L) && colorsEqual(buf, Bo, BL) ? Bo : P);
        copyPixel(outBuf, d3, buf, colorsEqual(buf, Bo, R) && colorsEqual(buf, Bo, BR) ? Bo : P);
      }
    }
  }

  for (let i = 0; i < outBuf.length; i += 4) {
    const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i+1], outBuf[i+2], outBuf[i+3]), palette.options, false);
    outBuf[i] = color[0]; outBuf[i+1] = color[1]; outBuf[i+2] = color[2];
  }

  outputCtx.putImageData(new ImageData(outBuf, oW, oH), 0, 0);
  return output;
};

export default defineFilter({ name: "Pixel Art Upscale", func: scale2x, optionTypes, options: defaults, defaults });
