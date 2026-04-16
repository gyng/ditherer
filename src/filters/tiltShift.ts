import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmTiltShiftBuffer,
  wasmIsLoaded,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity as paletteIsIdentityShared } from "palettes/backend";
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
  focusPosition: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical position of the in-focus band (0=top, 1=bottom)" },
  focusWidth: { type: RANGE, range: [0.01, 0.5], step: 0.01, default: 0.15, desc: "Height of the sharp focus band as fraction of image" },
  blurAmount: { type: RANGE, range: [1, 20], step: 1, default: 8, desc: "Gaussian blur sigma for out-of-focus areas" },
  saturationBoost: { type: RANGE, range: [0, 0.5], step: 0.05, default: 0.2, desc: "Extra color saturation for a miniature/toy look" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  focusPosition: optionTypes.focusPosition.default,
  focusWidth: optionTypes.focusWidth.default,
  blurAmount: optionTypes.blurAmount.default,
  saturationBoost: optionTypes.saturationBoost.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Shader radius cap — sigma=20 → ceil(3σ)=60, which fits comfortably within
// a 121-tap per-direction loop. Each shader loop bounds by u_radius to
// avoid paying for the cap when the user picks a small sigma.
const MAX_KERNEL_HALF = 60;

const TS_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_axis;               // (1, 0) horizontal, (0, 1) vertical
uniform int   u_radius;
uniform float u_weights[${MAX_KERNEL_HALF * 2 + 1}];

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec4 acc = vec4(0.0);
  for (int k = -${MAX_KERNEL_HALF}; k <= ${MAX_KERNEL_HALF}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    vec2 uv = vec2((nx + 0.5) / u_res.x, 1.0 - (ny + 0.5) / u_res.y);
    acc += texture(u_input, uv) * u_weights[k + ${MAX_KERNEL_HALF}];
  }
  fragColor = acc;
}
`;

const TS_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_blur;
uniform vec2  u_res;
uniform float u_focusCenter;   // pixel Y
uniform float u_bandHalf;
uniform float u_transitionZone;
uniform float u_saturationBoost;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);

  vec4 src = texture(u_source, suv);
  vec4 blur = texture(u_blur, suv);
  float dist = abs(y - u_focusCenter);
  float t = dist < u_bandHalf ? 0.0
    : smoothstep(0.0, 1.0, (dist - u_bandHalf) / max(u_transitionZone, 1e-4));
  vec3 rgb = mix(src.rgb, blur.rgb, t);

  if (u_saturationBoost > 0.0) {
    float gray = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    rgb = clamp(vec3(gray) + (rgb - vec3(gray)) * (1.0 + u_saturationBoost), 0.0, 1.0);
  }

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { blur: Program; comp: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blur: linkProgram(gl, TS_BLUR_FS, ["u_input", "u_res", "u_axis", "u_radius", "u_weights"] as const),
    comp: linkProgram(gl, TS_COMPOSITE_FS, [
      "u_source", "u_blur", "u_res", "u_focusCenter",
      "u_bandHalf", "u_transitionZone", "u_saturationBoost", "u_levels",
    ] as const),
  };
  return _cache;
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const tiltShiftFilter = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { focusPosition, focusWidth, blurAmount, saturationBoost, palette } = options;
  const W = input.width;
  const H = input.height;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "tiltShift:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const tempTex = ensureTexture(gl, "tiltShift:blurH", W, H);
      const blurTex = ensureTexture(gl, "tiltShift:blurV", W, H);

      const sigma = Math.max(0.5, blurAmount);
      const radius = Math.min(MAX_KERNEL_HALF, Math.ceil(sigma * 3));
      const weights = new Float32Array(MAX_KERNEL_HALF * 2 + 1);
      let kSum = 0;
      for (let i = -radius; i <= radius; i++) {
        const w = Math.exp(-(i * i) / (2 * sigma * sigma));
        weights[i + MAX_KERNEL_HALF] = w;
        kSum += w;
      }
      for (let i = -radius; i <= radius; i++) weights[i + MAX_KERNEL_HALF] /= kSum;

      // Horizontal pass
      drawPass(gl, tempTex, W, H, cache.blur, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.blur.uniforms.u_input, 0);
        gl.uniform2f(cache.blur.uniforms.u_res, W, H);
        gl.uniform2f(cache.blur.uniforms.u_axis, 1, 0);
        gl.uniform1i(cache.blur.uniforms.u_radius, radius);
        gl.uniform1fv(cache.blur.uniforms.u_weights, weights);
      }, vao);

      // Vertical pass
      drawPass(gl, blurTex, W, H, cache.blur, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempTex.tex);
        gl.uniform1i(cache.blur.uniforms.u_input, 0);
        gl.uniform2f(cache.blur.uniforms.u_res, W, H);
        gl.uniform2f(cache.blur.uniforms.u_axis, 0, 1);
        gl.uniform1i(cache.blur.uniforms.u_radius, radius);
        gl.uniform1fv(cache.blur.uniforms.u_weights, weights);
      }, vao);

      // Composite
      const focusCenter = H * focusPosition;
      const bandHalf = H * focusWidth / 2;
      const transitionZone = H * 0.3;
      drawPass(gl, null, W, H, cache.comp, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.comp.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, blurTex.tex);
        gl.uniform1i(cache.comp.uniforms.u_blur, 1);
        gl.uniform2f(cache.comp.uniforms.u_res, W, H);
        gl.uniform1f(cache.comp.uniforms.u_focusCenter, focusCenter);
        gl.uniform1f(cache.comp.uniforms.u_bandHalf, bandHalf);
        gl.uniform1f(cache.comp.uniforms.u_transitionZone, transitionZone);
        gl.uniform1f(cache.comp.uniforms.u_saturationBoost, saturationBoost);
        const identity = paletteIsIdentityShared(palette);
        gl.uniform1f(cache.comp.uniforms.u_levels, identity ? (paletteOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentityShared(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Tilt Shift", "WebGL2",
            `sigma=${blurAmount}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    const outBuf = new Uint8ClampedArray(buf.length);
    wasmTiltShiftBuffer(buf, outBuf, W, H, focusPosition, focusWidth, blurAmount, saturationBoost);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
      }
    }
    logFilterWasmStatus("Tilt Shift", true, paletteIsIdentity ? "blur+blend" : "blur+blend+palettePass");
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Tilt Shift", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  const sigma = blurAmount;
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let kSum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    kSum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  const temp = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const si = getBufferIndex(nx, y, W);
        const w = kernel[k + radius];
        r += buf[si] * w; g += buf[si + 1] * w; b += buf[si + 2] * w; a += buf[si + 3] * w;
      }
      const idx = (y * W + x) * 4;
      temp[idx] = r; temp[idx + 1] = g; temp[idx + 2] = b; temp[idx + 3] = a;
    }
  }

  const blurred = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const idx = (ny * W + x) * 4;
        const w = kernel[k + radius];
        r += temp[idx] * w; g += temp[idx + 1] * w; b += temp[idx + 2] * w; a += temp[idx + 3] * w;
      }
      const idx = (y * W + x) * 4;
      blurred[idx] = r; blurred[idx + 1] = g; blurred[idx + 2] = b; blurred[idx + 3] = a;
    }
  }

  const outBuf = new Uint8ClampedArray(buf.length);
  const focusCenter = H * focusPosition;
  const bandHalf = H * focusWidth / 2;
  const transitionZone = H * 0.3;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const bIdx = (y * W + x) * 4;

      const dist = Math.abs(y - focusCenter);
      const t = dist < bandHalf ? 0 : smoothstep(0, 1, (dist - bandHalf) / transitionZone);

      let r = Math.round(buf[i] * (1 - t) + blurred[bIdx] * t);
      let g = Math.round(buf[i + 1] * (1 - t) + blurred[bIdx + 1] * t);
      let b = Math.round(buf[i + 2] * (1 - t) + blurred[bIdx + 2] * t);

      if (saturationBoost > 0) {
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = Math.max(0, Math.min(255, Math.round(gray + (r - gray) * (1 + saturationBoost))));
        g = Math.max(0, Math.min(255, Math.round(gray + (g - gray) * (1 + saturationBoost))));
        b = Math.max(0, Math.min(255, Math.round(gray + (b - gray) * (1 + saturationBoost))));
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Tilt Shift",
  func: tiltShiftFilter,
  optionTypes,
  options: defaults,
  defaults
});
