import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { SRGB_GLSL, srgbToLinear, linearToSrgb } from "./opticalConvolutionContracts";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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
} from "../gl/index";

export const optionTypes = {
  strength: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Blur intensity — increases with distance from center" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal position of the blur center (0=left, 1=right)" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical position of the blur center (0=top, 1=bottom)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_center;
uniform float u_strength;
uniform float u_maxDist;
uniform int   u_samples;
uniform float u_levels;
${SRGB_GLSL}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 d = vec2(x, y) - u_center;
  float dist = length(d);
  float blurDist = (dist / u_maxDist) * u_strength;

  vec2 centerUV = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float srcA = texture(u_source, centerUV).a;

  vec3 rgb;
  if (blurDist < 0.5) {
    rgb = texture(u_source, centerUV).rgb;
  } else {
    // Zoom/spin blur integrates light along the sampled trajectory — average
    // the radiance in linear light, not the gamma-encoded sRGB values.
    vec3 accum = vec3(0.0);
    int n = u_samples;
    for (int t = 0; t < 64; t++) {
      if (t >= n) break;
      float frac = (float(t) / float(n - 1) - 0.5) * 2.0;
      float scale = 1.0 + frac * (blurDist / u_maxDist);
      vec2 s = u_center + d * scale;
      s = clamp(floor(s + 0.5), vec2(0.0), u_res - vec2(1.0));
      vec2 suv = vec2((s.x + 0.5) / u_res.x, 1.0 - (s.y + 0.5) / u_res.y);
      accum += oc_srgbToLinear(texture(u_source, suv).rgb);
    }
    vec3 outLin = accum / float(n);
    rgb = oc_linearToSrgb(outLin);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), srcA);
}
`;

type Cache = { blur: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blur: linkProgram(gl, BLUR_FS, [
      "u_source", "u_res", "u_center", "u_strength",
      "u_maxDist", "u_samples", "u_levels",
    ] as const),
  };
  return _cache;
};

const radialBlurFilter = (input: any, options = defaults) => {
  const { strength, centerX, centerY, palette } = options;
  const W = input.width;
  const H = input.height;
  const cx = W * centerX;
  const cy = H * centerY;
  const maxDist = Math.sqrt(W * W + H * H) / 2;
  const samples = Math.max(3, Math.min(64, Math.round(strength)));

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "radialBlur:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.blur, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.blur.uniforms.u_source, 0);
        gl.uniform2f(cache.blur.uniforms.u_res, W, H);
        gl.uniform2f(cache.blur.uniforms.u_center, cx, cy);
        gl.uniform1f(cache.blur.uniforms.u_strength, strength);
        gl.uniform1f(cache.blur.uniforms.u_maxDist, maxDist);
        gl.uniform1i(cache.blur.uniforms.u_samples, samples);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.blur.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Radial Blur", "WebGL2",
            `strength=${strength}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Radial Blur", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const blurDist = (dist / maxDist) * strength;

      const i = getBufferIndex(x, y, W);
      const srcA = buf[i + 3];

      if (blurDist < 0.5) {
        const color = paletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], srcA), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], srcA);
        continue;
      }

      // Zoom/spin blur integrates light along the sampled trajectory —
      // average the radiance in linear light, not the gamma-encoded sRGB
      // values. Alpha is a center-tap (not blurred/converted).
      let srLin = 0, sgLin = 0, sbLin = 0;
      let count = 0;

      for (let t = 0; t < samples; t++) {
        const frac = (t / (samples - 1) - 0.5) * 2;
        const scale = 1 + frac * (blurDist / maxDist);
        const sx = Math.round(cx + dx * scale);
        const sy = Math.round(cy + dy * scale);

        const csx = Math.max(0, Math.min(W - 1, sx));
        const csy = Math.max(0, Math.min(H - 1, sy));
        const si = getBufferIndex(csx, csy, W);
        srLin += srgbToLinear(buf[si] / 255);
        sgLin += srgbToLinear(buf[si + 1] / 255);
        sbLin += srgbToLinear(buf[si + 2] / 255);
        count++;
      }

      const r = Math.round(linearToSrgb(srLin / count) * 255);
      const g = Math.round(linearToSrgb(sgLin / count) * 255);
      const b = Math.round(linearToSrgb(sbLin / count) * 255);

      const color = paletteGetColor(palette, rgba(r, g, b, srcA), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], srcA);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Radial Blur",
  func: radialBlurFilter,
  optionTypes,
  options: defaults,
  defaults
});
