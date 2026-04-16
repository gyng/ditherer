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
  scale: { type: RANGE, range: [5, 200], step: 5, default: 50, desc: "Turbulence noise feature size" },
  strength: { type: RANGE, range: [0, 100], step: 1, default: 20, desc: "Pixel displacement distance" },
  octaves: { type: RANGE, range: [1, 6], step: 1, default: 3, desc: "Fractal detail layers" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for noise pattern" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  octaves: optionTypes.octaves.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Shader replicates the JS integer-hash used in the CPU path so visual
// output stays comparable. The `hash()` function mirrors the CPU mixer
// using uint32 arithmetic (GLSL ES 3.00 uint).
const TURB_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_scale;
uniform float u_strength;
uniform int   u_octaves;
uniform uint  u_seed;
uniform float u_levels;

uint imul32(uint a, uint b) { return a * b; }

float hash2(int xi, int yi, uint seed) {
  uint h = seed + uint(xi) * 374761393u + uint(yi) * 668265263u;
  h = (h ^ (h >> 13)) * 1274126177u;
  h = h ^ (h >> 16);
  return float(h) / 4294967295.0;
}

float noise2d(float px, float py, uint seed) {
  int x0 = int(floor(px));
  int y0 = int(floor(py));
  float fx = px - float(x0);
  float fy = py - float(y0);
  float u = fx * fx * (3.0 - 2.0 * fx);
  float v = fy * fy * (3.0 - 2.0 * fy);
  float n00 = hash2(x0, y0, seed) * 2.0 - 1.0;
  float n10 = hash2(x0 + 1, y0, seed) * 2.0 - 1.0;
  float n01 = hash2(x0, y0 + 1, seed) * 2.0 - 1.0;
  float n11 = hash2(x0 + 1, y0 + 1, seed) * 2.0 - 1.0;
  return n00 * (1.0 - u) * (1.0 - v) + n10 * u * (1.0 - v)
       + n01 * (1.0 - u) * v + n11 * u * v;
}

float fbm(float x, float y, int octaves, uint seed) {
  float value = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float maxAmp = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += noise2d(x * freq, y * freq, seed + uint(i) * 1000u) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return value / max(maxAmp, 1e-5);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float nx = x / u_scale, ny = y / u_scale;
  float dx = fbm(nx, ny, u_octaves, u_seed) * u_strength;
  float dy = fbm(nx, ny, u_octaves, u_seed + 500u) * u_strength;
  vec2 src = clamp(vec2(x + dx, y + dy), vec2(0.0), u_res - vec2(1.0));
  vec2 suv = vec2((src.x + 0.5) / u_res.x, 1.0 - (src.y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);
  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { turb: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    turb: linkProgram(gl, TURB_FS, [
      "u_source", "u_res", "u_scale", "u_strength", "u_octaves", "u_seed", "u_levels",
    ] as const),
  };
  return _cache;
};

const hash = (x: number, y: number, seed: number) => {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

const noise2d = (px: number, py: number, seed: number) => {
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const n00 = hash(x0, y0, seed) * 2 - 1;
  const n10 = hash(x0 + 1, y0, seed) * 2 - 1;
  const n01 = hash(x0, y0 + 1, seed) * 2 - 1;
  const n11 = hash(x0 + 1, y0 + 1, seed) * 2 - 1;
  return n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
};

const fbm = (x: number, y: number, octaves: number, seed: number) => {
  let value = 0, amp = 1, freq = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise2d(x * freq, y * freq, seed + i * 1000) * amp;
    maxAmp += amp; amp *= 0.5; freq *= 2;
  }
  return value / maxAmp;
};

const turbulence = (input: any, options = defaults) => {
  const { scale, strength, octaves, seed, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "turbulence:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.turb, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.turb.uniforms.u_source, 0);
        gl.uniform2f(cache.turb.uniforms.u_res, W, H);
        gl.uniform1f(cache.turb.uniforms.u_scale, scale);
        gl.uniform1f(cache.turb.uniforms.u_strength, strength);
        gl.uniform1i(cache.turb.uniforms.u_octaves, Math.max(1, Math.min(6, Math.round(octaves))));
        gl.uniform1ui(cache.turb.uniforms.u_seed, Math.abs(seed | 0) >>> 0);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.turb.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Turbulence", "WebGL2",
            `scale=${scale} oct=${octaves}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Turbulence", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / scale, ny = y / scale;
      const dx = fbm(nx, ny, octaves, seed) * strength;
      const dy = fbm(nx, ny, octaves, seed + 500) * strength;

      const sx = x + dx, sy = y + dy;
      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Turbulence", func: turbulence, optionTypes, options: defaults, defaults });
