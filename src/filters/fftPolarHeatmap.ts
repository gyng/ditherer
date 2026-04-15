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

// Polar heatmap of FFT magnitude rendered on a disc. Each output pixel's
// (r, θ) in image coordinates maps to an FFT sample — so bright directional
// streaks in the source become bright radial spokes, periodic patterns
// become bright rings. A "radar" view of the spectrum.

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform float u_scale;
uniform int   u_logRadius;
uniform float u_levels;

vec3 magCmap(float t) {
  vec3 a = vec3(0.0, 0.0, 4.0);
  vec3 b = vec3(87.0, 16.0, 110.0);
  vec3 c = vec3(188.0, 55.0, 84.0);
  vec3 d = vec3(249.0, 142.0, 9.0);
  vec3 e = vec3(252.0, 255.0, 164.0);
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
  float oy = u_outRes.y - 1.0 - floor(px.y);

  // Centre the disc; make radius fill the shorter axis.
  float cx = u_outRes.x * 0.5;
  float cy = u_outRes.y * 0.5;
  float dx = ox - cx;
  float dy = oy - cy;
  float rPx = sqrt(dx * dx + dy * dy);
  float rMax = min(cx, cy);
  if (rPx > rMax) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float theta = atan(dy, dx);
  // Remap disc radius → FFT radius (optionally log-scaled so high-freq rim
  // spreads out).
  float rNorm = rPx / rMax;
  float fftR;
  float fftRMax = min(u_padRes.x, u_padRes.y) * 0.5;
  if (u_logRadius == 1) {
    fftR = exp(rNorm * log(fftRMax + 1.0)) - 1.0;
  } else {
    fftR = rNorm * fftRMax;
  }

  float kx = fftR * cos(theta);
  float ky = fftR * sin(theta);
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
  logRadius: { type: BOOL, default: false, desc: "Log-scale radius — rim of the disc gets more resolution at high spatial frequencies" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  logRadius: optionTypes.logRadius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, [
      "u_fft", "u_padRes", "u_outRes", "u_scale", "u_logRadius", "u_levels",
    ] as const),
  };
  return _cache;
};

const fftPolarHeatmap = (input: any, options = defaults) => {
  const { scale, logRadius, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftPolarHeatmap:source", W, H);
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
          gl.uniform1i(cache.plot.uniforms.u_logRadius, logRadius ? 1 : 0);
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
            logFilterBackend("FFT Polar Heatmap", "WebGL2",
              `scale=${scale} log=${logRadius}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Polar Heatmap", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Polar Heatmap",
  func: fftPolarHeatmap,
  optionTypes,
  options: defaults,
  defaults,
  description: "FFT magnitude rendered on a polar disc — directional streaks in the source become radial spokes, periodic patterns become rings",
  noWASM: "Needs GPU 2D FFT.",
});
