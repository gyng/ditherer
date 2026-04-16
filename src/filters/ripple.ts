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
  amplitude: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Wave height in pixels" },
  wavelength: { type: RANGE, range: [5, 100], step: 1, default: 30, desc: "Distance between wave peaks" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of ripple origin" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of ripple origin" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amplitude: optionTypes.amplitude.default,
  wavelength: optionTypes.wavelength.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const RIPPLE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_amplitude;
uniform float u_wavelength;
uniform vec2  u_center;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec2 d = vec2(x, y) - u_center;
  float dist = length(d);
  vec2 src;
  if (dist < 1.0) {
    src = vec2(x, y);
  } else {
    float disp = sin(dist * 6.28318530718 / u_wavelength) * u_amplitude;
    src = vec2(x, y) + d / dist * disp;
  }
  src = clamp(src, vec2(0.0), u_res - vec2(1.0));
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

type Cache = { ripple: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ripple: linkProgram(gl, RIPPLE_FS, [
      "u_source", "u_res", "u_amplitude", "u_wavelength", "u_center", "u_levels",
    ] as const),
  };
  return _cache;
};

const rippleFilter = (input: any, options = defaults) => {
  const { amplitude, wavelength, centerX, centerY, palette } = options;
  const W = input.width, H = input.height;
  const cx = W * centerX, cy = H * centerY;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "ripple:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ripple, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ripple.uniforms.u_source, 0);
        gl.uniform2f(cache.ripple.uniforms.u_res, W, H);
        gl.uniform1f(cache.ripple.uniforms.u_amplitude, amplitude);
        gl.uniform1f(cache.ripple.uniforms.u_wavelength, wavelength);
        gl.uniform2f(cache.ripple.uniforms.u_center, cx, cy);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.ripple.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Ripple", "WebGL2",
            `amp=${amplitude} wl=${wavelength}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Ripple", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        const i = getBufferIndex(x, y, W);
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        continue;
      }

      const displacement = Math.sin(dist * 2 * Math.PI / wavelength) * amplitude;
      const sx = x + dx / dist * displacement;
      const sy = y + dy / dist * displacement;

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

export default defineFilter({ name: "Ripple", func: rippleFilter, optionTypes, options: defaults, defaults });
