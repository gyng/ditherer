import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import {
  cloneCanvas,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
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
  baseSpeed: { type: RANGE, range: [0, 10], step: 0.5, default: 2, desc: "Hue rotation degrees per frame for static areas" },
  motionMultiplier: { type: RANGE, range: [0, 20], step: 1, default: 8, desc: "Extra hue rotation per unit of motion" },
  saturationBoost: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Boost saturation in moving areas" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  baseSpeed: optionTypes.baseSpeed.default,
  motionMultiplier: optionTypes.motionMultiplier.default,
  saturationBoost: optionTypes.saturationBoost.default,
  animSpeed: optionTypes.animSpeed.default,
};

const rgb2hsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
    : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
};

const hue2rgb = (p: number, q: number, t: number) => {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
};

const hsl2rgb = (h: number, s: number, l: number): [number, number, number] => {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
};

type TemporalColorCycleOptions = FilterOptionValues & {
  baseSpeed?: number;
  motionMultiplier?: number;
  saturationBoost?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

// RGB↔HSL inside the shader so we can rotate hue per pixel. Motion amount
// comes from |source - EMA| uploaded as a RGBA8 texture (EMA is already in
// 0..255 range).
const CC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_ema;
uniform int   u_hasEma;
uniform float u_globalShift;       // degrees
uniform float u_motionMultiplier;
uniform float u_saturationBoost;

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = ((c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0)) / 6.0;
  else if (mx == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
  else h = ((c.r - c.g) / d + 4.0) / 6.0;
  return vec3(h * 360.0, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(float h, float s, float l) {
  h = mod(mod(h, 360.0) + 360.0, 360.0) / 360.0;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0)
  );
}

void main() {
  vec4 src = texture(u_source, v_uv);
  float motion = 0.0;
  if (u_hasEma == 1) {
    vec4 e = texture(u_ema, v_uv);
    vec3 d = abs(src.rgb - e.rgb);
    motion = (d.r + d.g + d.b) / 3.0;
  }
  vec3 hsl = rgb2hsl(src.rgb);
  float h = hsl.x + u_globalShift + motion * u_motionMultiplier * 30.0;
  float s = clamp(hsl.y + motion * u_saturationBoost, 0.0, 1.0);
  vec3 rgb = hsl2rgb(h, s, hsl.z);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { cc: Program; emaTex: WebGLTexture | null; emaBuf: Uint8ClampedArray | null; w: number; h: number };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  const prog = linkProgram(gl, CC_FS, [
    "u_source", "u_ema", "u_hasEma", "u_globalShift",
    "u_motionMultiplier", "u_saturationBoost",
  ] as const);
  _cache = { cc: prog, emaTex: null, emaBuf: null, w: 0, h: 0 };
  return _cache;
};

const ensureEmaTex = (gl: WebGL2RenderingContext, cache: Cache, w: number, h: number) => {
  if (cache.emaTex && cache.w === w && cache.h === h) return cache.emaTex;
  if (cache.emaTex) gl.deleteTexture(cache.emaTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.emaTex = tex;
  cache.emaBuf = null;
  cache.w = w;
  cache.h = h;
  return tex;
};

const temporalColorCycle = (input: any, options: TemporalColorCycleOptions = defaults) => {
  const baseSpeed = Number(options.baseSpeed ?? defaults.baseSpeed);
  const motionMultiplier = Number(options.motionMultiplier ?? defaults.motionMultiplier);
  const saturationBoost = Number(options.saturationBoost ?? defaults.saturationBoost);
  const ema = options._ema ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;
  const globalShift = frameIndex * baseSpeed;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "temporalColorCycle:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const emaTex = ensureEmaTex(gl, cache, W, H);
      const hasEma = !!(ema && emaTex && ema.length === W * H * 4);
      if (hasEma && emaTex && ema) {
        if (!cache.emaBuf || cache.emaBuf.length !== ema.length) {
          cache.emaBuf = new Uint8ClampedArray(ema.length);
        }
        const u8 = cache.emaBuf;
        for (let i = 0; i < ema.length; i++) u8[i] = ema[i];
        gl.bindTexture(gl.TEXTURE_2D, emaTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, u8);
      }

      drawPass(gl, null, W, H, cache.cc, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.cc.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, emaTex);
        gl.uniform1i(cache.cc.uniforms.u_ema, 1);
        gl.uniform1i(cache.cc.uniforms.u_hasEma, hasEma ? 1 : 0);
        gl.uniform1f(cache.cc.uniforms.u_globalShift, globalShift);
        gl.uniform1f(cache.cc.uniforms.u_motionMultiplier, motionMultiplier);
        gl.uniform1f(cache.cc.uniforms.u_saturationBoost, saturationBoost);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        logFilterBackend("Color Cycle", "WebGL2",
          `shift=${globalShift.toFixed(1)} motion=${motionMultiplier}`);
        return rendered;
      }
    }
  }

  logFilterWasmStatus("Color Cycle", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < buf.length; i += 4) {
    const motion = ema
      ? (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 765
      : 0;

    const [hRaw, sRaw, l] = rgb2hsl(buf[i], buf[i + 1], buf[i + 2]);
    const h = hRaw + globalShift + motion * motionMultiplier * 30;
    const s = Math.min(1, sRaw + motion * saturationBoost);
    const [r, g, b] = hsl2rgb(h, s, l);
    outBuf[i] = r; outBuf[i + 1] = g; outBuf[i + 2] = b; outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Color Cycle", func: temporalColorCycle, optionTypes, options: defaults, defaults, description: "Hue rotates over time — moving areas cycle faster creating rainbow trails" });
