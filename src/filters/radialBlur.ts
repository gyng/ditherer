import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
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

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 d = vec2(x, y) - u_center;
  float dist = length(d);
  float blurDist = (dist / u_maxDist) * u_strength;

  vec3 rgb;
  float a;
  if (blurDist < 0.5) {
    vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
    vec4 c = texture(u_source, suv);
    rgb = c.rgb; a = c.a;
  } else {
    vec4 accum = vec4(0.0);
    int n = u_samples;
    for (int t = 0; t < 64; t++) {
      if (t >= n) break;
      float frac = (float(t) / float(n - 1) - 0.5) * 2.0;
      float scale = 1.0 + frac * (blurDist / u_maxDist);
      vec2 s = u_center + d * scale;
      s = clamp(floor(s + 0.5), vec2(0.0), u_res - vec2(1.0));
      vec2 suv = vec2((s.x + 0.5) / u_res.x, 1.0 - (s.y + 0.5) / u_res.y);
      accum += texture(u_source, suv);
    }
    accum /= float(n);
    rgb = accum.rgb; a = accum.a;
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
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

      if (blurDist < 0.5) {
        const i = getBufferIndex(x, y, W);
        const color = paletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
        continue;
      }

      let sr = 0, sg = 0, sb = 0, sa = 0;
      let count = 0;

      for (let t = 0; t < samples; t++) {
        const frac = (t / (samples - 1) - 0.5) * 2;
        const scale = 1 + frac * (blurDist / maxDist);
        const sx = Math.round(cx + dx * scale);
        const sy = Math.round(cy + dy * scale);

        const csx = Math.max(0, Math.min(W - 1, sx));
        const csy = Math.max(0, Math.min(H - 1, sy));
        const si = getBufferIndex(csx, csy, W);
        sr += buf[si]; sg += buf[si + 1]; sb += buf[si + 2]; sa += buf[si + 3];
        count++;
      }

      const i = getBufferIndex(x, y, W);
      const r = Math.round(sr / count);
      const g = Math.round(sg / count);
      const b = Math.round(sb / count);
      const a = Math.round(sa / count);

      const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
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
