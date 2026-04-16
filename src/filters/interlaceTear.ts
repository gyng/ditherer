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
  tearOffset: { type: RANGE, range: [0, 100], step: 1, default: 20, desc: "Horizontal shift of torn scan lines" },
  tearPosition: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical position of the tear" },
  fieldShift: { type: RANGE, range: [0, 20], step: 1, default: 3, desc: "Interlace field displacement" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  tearOffset: optionTypes.tearOffset.default,
  tearPosition: optionTypes.tearPosition.default,
  fieldShift: optionTypes.fieldShift.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Shader replicates the CPU path's per-row row-index-driven shift math.
// Per-row pseudo-random noise is a positional hash of (y + seed) to keep
// visuals comparable frame-to-frame with the CPU reference.
const TEAR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_tearOffset;
uniform float u_tearY;
uniform float u_fieldShift;
uniform float u_seed;
uniform float u_levels;

float hash1(float n) {
  return fract(sin(n * 12.9898 + u_seed) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float isOdd = mod(y, 2.0);
  float baseShift = isOdd == 1.0 ? u_fieldShift : 0.0;

  float tearShift = 0.0;
  if (y > u_tearY) {
    tearShift = u_tearOffset + floor(hash1(y) * u_tearOffset * 0.3);
  } else if (abs(y - u_tearY) < 5.0) {
    float fade = 1.0 - abs(y - u_tearY) / 5.0;
    tearShift = floor(u_tearOffset * fade + hash1(y + 7.0) * 10.0);
  }

  float totalShift = baseShift + tearShift;
  float srcX = mod(x - totalShift, u_res.x);
  if (srcX < 0.0) srcX += u_res.x;

  vec2 suv = vec2((floor(srcX) + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);
  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { tear: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    tear: linkProgram(gl, TEAR_FS, [
      "u_source", "u_res", "u_tearOffset", "u_tearY",
      "u_fieldShift", "u_seed", "u_levels",
    ] as const),
  };
  return _cache;
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const interlaceTear = (input: any, options = defaults) => {
  const { tearOffset, tearPosition, fieldShift, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width, H = input.height;
  const tearY = Math.round(H * tearPosition);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "interlaceTear:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.tear, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.tear.uniforms.u_source, 0);
        gl.uniform2f(cache.tear.uniforms.u_res, W, H);
        gl.uniform1f(cache.tear.uniforms.u_tearOffset, tearOffset);
        gl.uniform1f(cache.tear.uniforms.u_tearY, tearY);
        gl.uniform1f(cache.tear.uniforms.u_fieldShift, fieldShift);
        gl.uniform1f(cache.tear.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.tear.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Interlace Tear", "WebGL2",
            `tearOff=${tearOffset}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Interlace Tear", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 31337);

  for (let y = 0; y < H; y++) {
    const isOddField = y % 2 === 1;
    const baseShift = isOddField ? fieldShift : 0;

    let tearShift = 0;
    if (y > tearY) {
      tearShift = tearOffset + Math.round(rng() * tearOffset * 0.3);
    } else if (Math.abs(y - tearY) < 5) {
      tearShift = Math.round(tearOffset * (1 - Math.abs(y - tearY) / 5) + rng() * 10);
    }

    const totalShift = baseShift + tearShift;

    for (let x = 0; x < W; x++) {
      const srcX = ((x - totalShift) % W + W) % W;
      const si = getBufferIndex(srcX, y, W);
      const di = getBufferIndex(x, y, W);

      const color = paletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[si + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Interlace Tear", func: interlaceTear, optionTypes, options: defaults, defaults });
