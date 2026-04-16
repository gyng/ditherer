import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
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

export const optionTypes = {
  resolution: { type: RANGE, range: [50, 300], step: 10, default: 100, desc: "Effective scan DPI" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white threshold for fax output" },
  scanNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Random scan-line noise amount" },
  yellowing: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Aged paper yellowing intensity" },
  compression: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Simulated compression artifact level" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  threshold: optionTypes.threshold.default,
  scanNoise: optionTypes.scanNoise.default,
  yellowing: optionTypes.yellowing.default,
  compression: optionTypes.compression.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const FAX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_scale;
uniform float u_threshold;    // 0..255
uniform float u_scanNoise;
uniform float u_yellowing;
uniform float u_compression;
uniform float u_seed;

// Positional 2D hash (cheap, uncorrelated enough for fax-paper dropouts).
float hash2(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Per-row scan shift: a small horizontal offset on a small fraction of
  // rows. Fires when row-hash < scanNoise * 0.1.
  float rowRoll = hash2(vec2(float(y), u_seed));
  float rowShiftTrigger = hash2(vec2(u_seed + 11.0, float(y)));
  float scanShift = (rowRoll < u_scanNoise * 0.1)
    ? floor((rowShiftTrigger - 0.5) * 10.0)
    : 0.0;

  float sx = floor(x / u_scale) * u_scale;
  float sy = floor(y / u_scale) * u_scale;
  float srcX = clamp(sx + scanShift, 0.0, u_res.x - 1.0);
  float srcY = clamp(sy, 0.0, u_res.y - 1.0);

  vec2 suv = vec2((srcX + 0.5) / u_res.x, 1.0 - (srcY + 0.5) / u_res.y);
  vec3 c = texture(u_source, suv).rgb;
  float lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * 255.0;

  // Per-pixel noise added before thresholding.
  float pxRand = hash2(vec2(x, y) + u_seed);
  float noise = (pxRand - 0.5) * u_scanNoise * 80.0;
  bool isBlack = (lum + noise) < u_threshold;

  // Compression dropouts: small chance of an "ink fail" — ink pixel flips
  // back to paper.
  float dropRand = hash2(vec2(x + 137.0, y + 37.0) + u_seed * 3.0);
  bool dropped = dropRand < u_compression * 0.05;

  vec3 paper = vec3(
    (245.0 - u_yellowing * 30.0) / 255.0,
    (240.0 - u_yellowing * 40.0) / 255.0,
    (230.0 - u_yellowing * 70.0) / 255.0
  );

  vec3 rgb;
  if (isBlack && !dropped) {
    float inkRand = hash2(vec2(x + 91.0, y + 53.0) + u_seed * 5.0);
    float ink = 0.85 + inkRand * 0.15;
    rgb = vec3(20.0, 20.0, 25.0) * ink / 255.0;
  } else {
    rgb = paper;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { fax: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    fax: linkProgram(gl, FAX_FS, [
      "u_source", "u_res", "u_scale", "u_threshold",
      "u_scanNoise", "u_yellowing", "u_compression", "u_seed",
    ] as const),
  };
  return _cache;
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const faxMachine = (input: any, options = defaults) => {
  const { resolution, threshold, scanNoise, yellowing, compression, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width, H = input.height;
  const scale = Math.max(1, Math.round(W / resolution));

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "faxMachine:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.fax, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.fax.uniforms.u_source, 0);
        gl.uniform2f(cache.fax.uniforms.u_res, W, H);
        gl.uniform1f(cache.fax.uniforms.u_scale, scale);
        gl.uniform1f(cache.fax.uniforms.u_threshold, threshold);
        gl.uniform1f(cache.fax.uniforms.u_scanNoise, scanNoise);
        gl.uniform1f(cache.fax.uniforms.u_yellowing, yellowing);
        gl.uniform1f(cache.fax.uniforms.u_compression, compression);
        gl.uniform1f(cache.fax.uniforms.u_seed, ((frameIndex * 7919 + 42) % 1000000) * 0.001);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Fax Machine", "WebGL2",
            `res=${resolution} thresh=${threshold}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Fax Machine", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 42);

  const paperR = Math.round(245 - yellowing * 30);
  const paperG = Math.round(240 - yellowing * 40);
  const paperB = Math.round(230 - yellowing * 70);

  for (let y = 0; y < H; y++) {
    const scanShift = scanNoise > 0 && rng() < scanNoise * 0.1 ? Math.round((rng() - 0.5) * 10) : 0;

    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / scale) * scale;
      const sy = Math.floor(y / scale) * scale;
      const srcX = Math.max(0, Math.min(W - 1, sx + scanShift));
      const si = getBufferIndex(srcX, Math.min(H - 1, sy), W);

      const lum = 0.2126 * buf[si] + 0.7152 * buf[si + 1] + 0.0722 * buf[si + 2];
      const noise = scanNoise > 0 ? (rng() - 0.5) * scanNoise * 80 : 0;
      const isBlack = (lum + noise) < threshold;
      const dropped = compression > 0 && rng() < compression * 0.05;

      const i = getBufferIndex(x, y, W);
      if (isBlack && !dropped) {
        const ink = 0.85 + rng() * 0.15;
        outBuf[i] = Math.round(20 * ink);
        outBuf[i + 1] = Math.round(20 * ink);
        outBuf[i + 2] = Math.round(25 * ink);
      } else {
        outBuf[i] = paperR;
        outBuf[i + 1] = paperG;
        outBuf[i + 2] = paperB;
      }
      outBuf[i + 3] = 255;
    }
  }

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Fax Machine", func: faxMachine, optionTypes, options: defaults, defaults });
