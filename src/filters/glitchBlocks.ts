import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
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
  blockCount: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Number of glitch blocks per frame" },
  maxBlockSize: { type: RANGE, range: [10, 200], step: 5, default: 60, desc: "Maximum block dimension in pixels" },
  corruption: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Intensity of color/offset corruption" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 8 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 8); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  blockCount: optionTypes.blockCount.default,
  maxBlockSize: optionTypes.maxBlockSize.default,
  corruption: optionTypes.corruption.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const MAX_BLOCKS = 50;

// For each pixel, walk the precomputed block list in order. Each block
// entry is (dstX, dstY, bw, bh, srcDX, srcDY, chOffX); we track the last
// block that covers the current pixel and sample accordingly. This
// preserves the CPU path's "later blocks overwrite earlier" semantics.
const GLITCH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_blockCount;
// Pack block data into two vec4 arrays to keep uniform count manageable.
// A: (dstX, dstY, bw, bh);  B: (srcDX, srcDY, chOffX, _)
uniform vec4  u_blockA[50];
uniform vec4  u_blockB[50];
uniform float u_levels;

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 base = samplePx(x, y);
  vec3 rgb = base.rgb;
  float a = base.a;

  int lastHit = -1;
  for (int b = 0; b < 50; b++) {
    if (b >= u_blockCount) break;
    vec4 A = u_blockA[b];
    float dxB = A.x, dyB = A.y, bw = A.z, bh = A.w;
    if (x >= dxB && x < dxB + bw && y >= dyB && y < dyB + bh) {
      lastHit = b;
    }
  }
  if (lastHit >= 0) {
    // GLSL ES 3.00 disallows non-const indexing into uniform arrays in some
    // drivers — walk again to the matching index to read its values.
    vec4 A = vec4(0.0);
    vec4 B = vec4(0.0);
    for (int b = 0; b < 50; b++) {
      if (b == lastHit) { A = u_blockA[b]; B = u_blockB[b]; }
    }
    float dxB = A.x, dyB = A.y;
    float srcDX = B.x, srcDY = B.y, chOff = B.z;
    float lx = x - dxB;
    float ly = y - dyB;
    float sx = srcDX + lx;
    float sy = srcDY + ly;
    vec4 src = samplePx(sx, sy);
    vec4 srcR = samplePx(sx + chOff, sy);
    rgb = vec3(srcR.r, src.g, src.b);
    a = src.a;
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

type Cache = { glitch: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    glitch: linkProgram(gl, GLITCH_FS, [
      "u_source", "u_res", "u_blockCount", "u_blockA", "u_blockB", "u_levels",
    ] as const),
  };
  return _cache;
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const glitchBlocks = (input: any, options = defaults) => {
  const { blockCount, maxBlockSize, corruption, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width, H = input.height;

  // Precompute block list — same RNG order as the original CPU path, so
  // the GL output lines up with the reference frame for reproducibility.
  const rng = mulberry32(frameIndex * 7919 + 31337);
  const n = Math.max(0, Math.min(MAX_BLOCKS, Math.round(blockCount)));
  const blockA = new Float32Array(MAX_BLOCKS * 4);
  const blockB = new Float32Array(MAX_BLOCKS * 4);
  type Block = { srcX: number; srcY: number; dstX: number; dstY: number; bw: number; bh: number; chOff: number };
  const blocks: Block[] = [];
  for (let b = 0; b < n; b++) {
    const bw = Math.round(10 + rng() * (maxBlockSize - 10));
    const bh = Math.round(10 + rng() * (maxBlockSize - 10));
    const srcX = Math.floor(rng() * Math.max(1, W - bw));
    const srcY = Math.floor(rng() * Math.max(1, H - bh));
    const dstX = Math.floor(rng() * Math.max(1, W - bw));
    const dstY = Math.floor(rng() * Math.max(1, H - bh));
    const chOff = corruption > 0 ? Math.round((rng() - 0.5) * corruption * 20) : 0;
    blocks.push({ srcX, srcY, dstX, dstY, bw, bh, chOff });
    blockA[b * 4] = dstX;
    blockA[b * 4 + 1] = dstY;
    blockA[b * 4 + 2] = bw;
    blockA[b * 4 + 3] = bh;
    blockB[b * 4] = srcX;
    blockB[b * 4 + 1] = srcY;
    blockB[b * 4 + 2] = chOff;
  }

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "glitchBlocks:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.glitch, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.glitch.uniforms.u_source, 0);
        gl.uniform2f(cache.glitch.uniforms.u_res, W, H);
        gl.uniform1i(cache.glitch.uniforms.u_blockCount, n);
        gl.uniform4fv(cache.glitch.uniforms.u_blockA, blockA);
        gl.uniform4fv(cache.glitch.uniforms.u_blockB, blockB);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.glitch.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Glitch Blocks", "WebGL2",
            `n=${n}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Glitch Blocks", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  outBuf.set(buf);

  for (const blk of blocks) {
    const { srcX, srcY, dstX, dstY, bw, bh, chOff } = blk;
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        const sx = srcX + dx, sy = srcY + dy;
        const px = dstX + dx, py = dstY + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;

        const si = getBufferIndex(sx, sy, W);
        const di = getBufferIndex(px, py, W);
        const rSrcX = Math.max(0, Math.min(W - 1, sx + chOff));
        const ri = getBufferIndex(rSrcX, sy, W);

        outBuf[di] = buf[ri];
        outBuf[di + 1] = buf[si + 1];
        outBuf[di + 2] = buf[si + 2];
        outBuf[di + 3] = buf[si + 3];
      }
    }
  }

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Glitch Blocks", func: glitchBlocks, optionTypes, options: defaults, defaults });
