import { ACTION, RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
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
  noiseAmount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Intensity of per-pixel random static noise" },
  barHeight: { type: RANGE, range: [1, 100], step: 1, default: 20, desc: "Height of horizontal noise bars in pixels" },
  barIntensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Brightness variation of horizontal noise bars" },
  verticalHold: { type: RANGE, range: [0, 50], step: 1, default: 0, desc: "Vertical rolling/shifting of the image per frame" },
  ghosting: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Horizontal echo/shadow from a shifted copy of the image" },
  color: { type: BOOL, default: false, desc: "Use color noise instead of monochrome" },
  persistence: { type: RANGE, range: [0, 0.5], step: 0.05, default: 0, desc: "Blend previous frame's noise — bright dots linger like real CRT static" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  noiseAmount: optionTypes.noiseAmount.default,
  barHeight: optionTypes.barHeight.default,
  barIntensity: optionTypes.barIntensity.default,
  verticalHold: optionTypes.verticalHold.default,
  ghosting: optionTypes.ghosting.default,
  color: optionTypes.color.default,
  persistence: optionTypes.persistence.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type AnalogStaticOptions = FilterOptionValues & {
  noiseAmount?: number;
  barHeight?: number;
  barIntensity?: number;
  verticalHold?: number;
  ghosting?: number;
  color?: boolean;
  persistence?: number;
  animSpeed?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
  _prevOutput?: Uint8ClampedArray | null;
  _webglAcceleration?: boolean;
};

// Shader replicates the JS per-row bar noise (one random value per bar,
// shared across all pixels in that bar) and the per-pixel static noise,
// both seeded from frameIndex so the visual matches the JS path frame to
// frame. Ghosting samples a horizontally-shifted copy; persistence blends
// with the previous output texture.
const AS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prev;
uniform vec2  u_res;
uniform int   u_hasPrev;
uniform float u_noiseAmount;
uniform float u_barHeight;
uniform float u_barIntensity;
uniform int   u_vShift;
uniform float u_ghosting;
uniform int   u_color;
uniform float u_persistence;
uniform float u_seed;
uniform float u_frameIndex;
uniform float u_levels;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float srcY = mod(y - float(u_vShift), u_res.y);
  if (srcY < 0.0) srcY += u_res.y;

  vec3 c = samplePx(x, srcY);

  if (u_ghosting > 0.0) {
    float ghostX = clamp(x - 3.0, 0.0, u_res.x - 1.0);
    float gr = samplePx(ghostX, srcY).r;   // JS uses the R channel for all three (copy of buf[gi])
    float mix1 = u_ghosting * 0.5;
    c = c * (1.0 - mix1) + vec3(gr) * mix1;
  }

  float barY = floor(y / max(u_barHeight, 1.0));
  float barR = hash(vec2(barY, 0.0), u_seed + u_frameIndex * 31.0);
  float bar = (barR - 0.5) * 2.0 * u_barIntensity;
  c += vec3(bar);

  if (u_noiseAmount > 0.0) {
    if (u_color == 1) {
      float nr = (hash(vec2(x, y), u_seed + 1.0) - 0.5) * u_noiseAmount * 2.0;
      float ng = (hash(vec2(x, y), u_seed + 2.0) - 0.5) * u_noiseAmount * 2.0;
      float nb = (hash(vec2(x, y), u_seed + 3.0) - 0.5) * u_noiseAmount * 2.0;
      c += vec3(nr, ng, nb);
    } else {
      float n = (hash(vec2(x, y), u_seed) - 0.5) * u_noiseAmount * 2.0;
      c += vec3(n);
    }
  }

  vec3 rgb = clamp(c, 0.0, 1.0);

  if (u_persistence > 0.0 && u_hasPrev == 1) {
    vec4 prev = texture(u_prev, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y));
    rgb = rgb * (1.0 - u_persistence) + prev.rgb * u_persistence;
  }

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { prog: Program; prevTex: WebGLTexture | null; prevBuf: Uint8ClampedArray | null; w: number; h: number };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  const prog = linkProgram(gl, AS_FS, [
    "u_source", "u_prev", "u_res", "u_hasPrev",
    "u_noiseAmount", "u_barHeight", "u_barIntensity",
    "u_vShift", "u_ghosting", "u_color", "u_persistence",
    "u_seed", "u_frameIndex", "u_levels",
  ] as const);
  _cache = { prog, prevTex: null, prevBuf: null, w: 0, h: 0 };
  return _cache;
};

const ensurePrevTex = (gl: WebGL2RenderingContext, cache: Cache, w: number, h: number) => {
  if (cache.prevTex && cache.w === w && cache.h === h) return cache.prevTex;
  if (cache.prevTex) gl.deleteTexture(cache.prevTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.prevTex = tex;
  cache.prevBuf = null;
  cache.w = w;
  cache.h = h;
  return tex;
};

const analogStatic = (input: any, options: AnalogStaticOptions = defaults) => {
  const noiseAmount = Number(options.noiseAmount ?? defaults.noiseAmount);
  const barHeight = Number(options.barHeight ?? defaults.barHeight);
  const barIntensity = Number(options.barIntensity ?? defaults.barIntensity);
  const verticalHold = Number(options.verticalHold ?? defaults.verticalHold);
  const ghosting = Number(options.ghosting ?? defaults.ghosting);
  const colorNoise = Boolean(options.color ?? defaults.color);
  const persistence = Number(options.persistence ?? defaults.persistence);
  const palette = options.palette ?? defaults.palette;
  const frameIndex = Number(options._frameIndex ?? 0);
  const prevOutput = options._prevOutput ?? null;

  const W = input.width;
  const H = input.height;
  const vShift = Math.round(verticalHold * Math.sin(frameIndex * 0.3));

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "analogStatic:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const prevTex = ensurePrevTex(gl, cache, W, H);
      const hasPrev = !!(prevOutput && prevTex && prevOutput.length === W * H * 4);
      if (hasPrev && prevTex && prevOutput) {
        if (!cache.prevBuf || cache.prevBuf.length !== prevOutput.length) {
          cache.prevBuf = new Uint8ClampedArray(prevOutput.length);
        }
        cache.prevBuf.set(prevOutput);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, cache.prevBuf);
      }

      drawPass(gl, null, W, H, cache.prog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.prog.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.uniform1i(cache.prog.uniforms.u_prev, 1);
        gl.uniform2f(cache.prog.uniforms.u_res, W, H);
        gl.uniform1i(cache.prog.uniforms.u_hasPrev, hasPrev ? 1 : 0);
        gl.uniform1f(cache.prog.uniforms.u_noiseAmount, noiseAmount);
        gl.uniform1f(cache.prog.uniforms.u_barHeight, Math.max(1, barHeight));
        gl.uniform1f(cache.prog.uniforms.u_barIntensity, barIntensity);
        gl.uniform1i(cache.prog.uniforms.u_vShift, vShift);
        gl.uniform1f(cache.prog.uniforms.u_ghosting, ghosting);
        gl.uniform1i(cache.prog.uniforms.u_color, colorNoise ? 1 : 0);
        gl.uniform1f(cache.prog.uniforms.u_persistence, persistence);
        gl.uniform1f(cache.prog.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        gl.uniform1f(cache.prog.uniforms.u_frameIndex, frameIndex);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.prog.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Analog Static", "WebGL2",
            `noise=${noiseAmount}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Analog Static", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  const barNoise = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const barY = Math.floor(y / barHeight);
    const barRng = mulberry32(barY * 997 + frameIndex * 31);
    barNoise[y] = (barRng() - 0.5) * 2 * barIntensity;
  }

  for (let y = 0; y < H; y++) {
    const srcY = ((y - vShift) % H + H) % H;

    for (let x = 0; x < W; x++) {
      const si = getBufferIndex(x, srcY, W);
      const di = getBufferIndex(x, y, W);

      let r = buf[si];
      let g = buf[si + 1];
      let b = buf[si + 2];

      if (ghosting > 0) {
        const ghostX = Math.max(0, Math.min(W - 1, x - 3));
        const gi = getBufferIndex(ghostX, srcY, W);
        r = Math.round(r * (1 - ghosting * 0.5) + buf[gi] * ghosting * 0.5);
        g = Math.round(g * (1 - ghosting * 0.5) + buf[gi] * ghosting * 0.5);
        b = Math.round(b * (1 - ghosting * 0.5) + buf[gi] * ghosting * 0.5);
      }

      const bar = barNoise[y] * 255;
      r = Math.max(0, Math.min(255, Math.round(r + bar)));
      g = Math.max(0, Math.min(255, Math.round(g + bar)));
      b = Math.max(0, Math.min(255, Math.round(b + bar)));

      if (noiseAmount > 0) {
        if (colorNoise) {
          r = Math.max(0, Math.min(255, Math.round(r + (rng() - 0.5) * noiseAmount * 510)));
          g = Math.max(0, Math.min(255, Math.round(g + (rng() - 0.5) * noiseAmount * 510)));
          b = Math.max(0, Math.min(255, Math.round(b + (rng() - 0.5) * noiseAmount * 510)));
        } else {
          const n = (rng() - 0.5) * noiseAmount * 510;
          r = Math.max(0, Math.min(255, Math.round(r + n)));
          g = Math.max(0, Math.min(255, Math.round(g + n)));
          b = Math.max(0, Math.min(255, Math.round(b + n)));
        }
      }

      const c = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, di, c[0], c[1], c[2], 255);
    }
  }

  if (persistence > 0 && prevOutput && prevOutput.length === outBuf.length) {
    const keep = persistence;
    const fresh = 1 - keep;
    for (let j = 0; j < outBuf.length; j += 4) {
      outBuf[j]     = Math.round(outBuf[j]     * fresh + prevOutput[j]     * keep);
      outBuf[j + 1] = Math.round(outBuf[j + 1] * fresh + prevOutput[j + 1] * keep);
      outBuf[j + 2] = Math.round(outBuf[j + 2] * fresh + prevOutput[j + 2] * keep);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Analog Static",
  func: analogStatic,
  optionTypes,
  options: defaults,
  defaults,
  temporal: true,
});
