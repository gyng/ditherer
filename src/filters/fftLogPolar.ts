import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "utils";
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
import { fft2dAvailable, forwardFFT2D } from "gl/fft2d";

// Log-polar FFT magnitude plot. Output axes: x = angle ∈ [0, π) (FFT of a
// real image is 180°-symmetric), y = log(radius). Rotations in the source
// become horizontal shifts; uniform scaling becomes vertical shifts — the
// transform is rotation- and scale-invariant up to translation, which is
// why it's classical for pattern registration.

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform float u_scale;
uniform float u_rMin;
uniform float u_rMax;
uniform int   u_mirror;        // 0 = [0, π), 1 = [0, 2π) (rarely useful for real images)
uniform float u_levels;

vec3 magCmap(float t) {
  vec3 a = vec3(68.0, 1.0, 84.0);
  vec3 b = vec3(59.0, 82.0, 139.0);
  vec3 c = vec3(33.0, 145.0, 140.0);
  vec3 d = vec3(94.0, 201.0, 98.0);
  vec3 e = vec3(253.0, 231.0, 37.0);
  float tc = clamp(t, 0.0, 1.0) * 4.0;
  int idx = int(floor(tc));
  float frac = tc - float(idx);
  vec3 stops[5] = vec3[5](a, b, c, d, e);
  if (idx >= 4) return e;
  return stops[idx] + (stops[idx + 1] - stops[idx]) * frac;
}

void main() {
  vec2 px = v_uv * u_outRes;
  float ox = floor(px.x);
  float oy = floor(px.y);
  // Output y = 0 maps to r = rMin (top); y = outH maps to r = rMax (bottom).
  // Flip so higher-up = higher frequency (more intuitive).
  float u = ox / u_outRes.x;
  float v = 1.0 - (oy / u_outRes.y);

  float thetaSpan = u_mirror == 1 ? 6.28318530718 : 3.14159265359;
  float theta = u * thetaSpan;
  float logRad = mix(log(u_rMin), log(u_rMax), v);
  float r = exp(logRad);

  float kx = r * cos(theta);
  float ky = r * sin(theta);
  float fx = kx < 0.0 ? kx + u_padRes.x : kx;
  float fy = ky < 0.0 ? ky + u_padRes.y : ky;
  fx = mod(fx, u_padRes.x);
  fy = mod(fy, u_padRes.y);

  vec4 c = texelFetch(u_fft, ivec2(fx, fy), 0);
  float mag = length(c.rg);
  float t = log(1.0 + mag * u_scale) / log(1.0 + u_scale);
  vec3 rgb = magCmap(t) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  scale: { type: RANGE, range: [1, 10000], step: 10, default: 1000, desc: "Brightness scale" },
  rMin: { type: RANGE, range: [0.1, 10], step: 0.1, default: 0.5, desc: "Minimum radius sampled (px)" },
  rMax: { type: RANGE, range: [10, 1024], step: 1, default: 256, desc: "Maximum radius sampled (px)" },
  fullTurn: { type: BOOL, default: false, desc: "Show full 2π instead of π (redundant for real images but useful for complex sources)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  rMin: optionTypes.rMin.default,
  rMax: optionTypes.rMax.default,
  fullTurn: optionTypes.fullTurn.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, [
      "u_fft", "u_padRes", "u_outRes", "u_scale",
      "u_rMin", "u_rMax", "u_mirror", "u_levels",
    ] as const),
  };
  return _cache;
};

const fftLogPolar = (input: any, options = defaults) => {
  const { scale, rMin, rMax, fullTurn, palette } = options;
  const W = input.width;
  const H = input.height;

  if (
    glAvailable()
    && fft2dAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "fftLogPolar:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        drawPass(gl, null, W, H, cache.plot, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
          gl.uniform1i(cache.plot.uniforms.u_fft, 0);
          gl.uniform2f(cache.plot.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
          gl.uniform2f(cache.plot.uniforms.u_outRes, W, H);
          gl.uniform1f(cache.plot.uniforms.u_scale, scale);
          gl.uniform1f(cache.plot.uniforms.u_rMin, rMin);
          gl.uniform1f(cache.plot.uniforms.u_rMax, Math.min(rMax, Math.min(fwd.paddedW, fwd.paddedH) * 0.5));
          gl.uniform1i(cache.plot.uniforms.u_mirror, fullTurn ? 1 : 0);
          const identity = paletteIsIdentity(palette);
          const pOpts = (palette as { options?: { levels?: number } }).options;
          const levels = identity ? (pOpts?.levels ?? 256) : 256;
          gl.uniform1f(cache.plot.uniforms.u_levels, levels);
        }, vao);
        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const identity = paletteIsIdentity(palette);
          const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("FFT Log-Polar", "WebGL2",
              `scale=${scale} r=[${rMin}, ${rMax}]${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Log-Polar", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Log-Polar",
  func: fftLogPolar,
  optionTypes,
  options: defaults,
  defaults,
  description: "Log-polar remap of the FFT magnitude. Rotations → horizontal shifts, scaling → vertical shifts (rotation/scale-invariant up to translation)",
  noWASM: "Needs GPU 2D FFT.",
});
