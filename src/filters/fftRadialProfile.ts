import { BOOL, RANGE, PALETTE } from "constants/controlTypes";
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

// Radial power-spectrum profile as a 1D line graph. For each radial bin r,
// we sum |X[kx,ky]|² over FFT bins whose radius is r. Plotted as a line
// graph along the canvas width — natural images typically show a ~1/f
// slope, patterned images show sharp peaks.

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform float u_logScale;    // 0 = linear y-axis, 1 = log
uniform int   u_numSamples;  // FFT samples to average per radial bin
uniform vec3  u_lineColor;
uniform vec3  u_bgColor;
uniform vec3  u_gridColor;
uniform int   u_showGrid;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_outRes;
  float ox = floor(px.x);
  float oy = u_outRes.y - 1.0 - floor(px.y);

  // Output-x → radial fraction 0..1 (where 1 = sqrt(2) × Nyquist).
  float rFrac = ox / u_outRes.x;
  // Sample the FFT along a horizontal line at radius rFrac by stepping
  // angle. Averaging a few angles keeps the profile smooth.
  float sum = 0.0;
  float weight = 0.0;
  float kMax = u_padRes.x * 0.5 * sqrt(2.0);
  float k = rFrac * kMax;
  for (int i = 0; i < 64; i++) {
    if (i >= u_numSamples) break;
    float theta = 6.28318530718 * float(i) / float(u_numSamples);
    float kx = k * cos(theta);
    float ky = k * sin(theta);
    // FFT indexing wraps: negative freq → add padRes.
    float fx = kx < 0.0 ? kx + u_padRes.x : kx;
    float fy = ky < 0.0 ? ky + u_padRes.y : ky;
    fx = mod(fx, u_padRes.x);
    fy = mod(fy, u_padRes.y);
    vec4 c = texelFetch(u_fft, ivec2(fx, fy), 0);
    sum += c.r * c.r + c.g * c.g;
    weight += 1.0;
  }
  float power = sum / max(weight, 1.0);

  // Convert to [0, 1] y coordinate.
  float y01;
  if (u_logScale > 0.5) {
    y01 = clamp(log(1.0 + power) / log(1.0 + 1e5), 0.0, 1.0);
  } else {
    y01 = clamp(power / 1e4, 0.0, 1.0);
  }

  // Draw: line thickness 2 px; under-line shade; grid every 10% of height.
  float lineY = y01 * u_outRes.y;
  float distFromLine = abs(oy - lineY);
  float lineMask = 1.0 - smoothstep(0.0, 1.5, distFromLine);
  float underLine = oy < lineY ? 0.35 : 0.0;

  vec3 rgb = u_bgColor;
  // Grid
  if (u_showGrid == 1) {
    float gridY = mod(oy / u_outRes.y, 0.1);
    float gridX = mod(ox / u_outRes.x, 0.1);
    if (gridY < 0.005 || gridY > 0.095) rgb = mix(rgb, u_gridColor, 0.3);
    if (gridX < 0.005 || gridX > 0.095) rgb = mix(rgb, u_gridColor, 0.3);
  }
  rgb = mix(rgb, u_lineColor, underLine);
  rgb = mix(rgb, u_lineColor, lineMask);

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  logScale: { type: BOOL, default: true, desc: "Log y-axis — typical natural-image 1/f slope becomes a straight line" },
  samples: { type: RANGE, range: [4, 64], step: 1, default: 24, desc: "Number of angular samples averaged per radial bin" },
  showGrid: { type: BOOL, default: true, desc: "Show reference grid" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  logScale: optionTypes.logScale.default,
  samples: optionTypes.samples.default,
  showGrid: optionTypes.showGrid.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, [
      "u_fft", "u_padRes", "u_outRes", "u_logScale", "u_numSamples",
      "u_lineColor", "u_bgColor", "u_gridColor", "u_showGrid", "u_levels",
    ] as const),
  };
  return _cache;
};

const fftRadialProfile = (input: any, options = defaults) => {
  const { logScale, samples, showGrid, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftRadialProfile:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        drawPass(gl, null, W, H, cache.plot, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
          gl.uniform1i(cache.plot.uniforms.u_fft, 0);
          gl.uniform2f(cache.plot.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
          gl.uniform2f(cache.plot.uniforms.u_outRes, W, H);
          gl.uniform1f(cache.plot.uniforms.u_logScale, logScale ? 1 : 0);
          gl.uniform1i(cache.plot.uniforms.u_numSamples, samples);
          gl.uniform3f(cache.plot.uniforms.u_lineColor, 120, 220, 120);
          gl.uniform3f(cache.plot.uniforms.u_bgColor, 20, 24, 28);
          gl.uniform3f(cache.plot.uniforms.u_gridColor, 60, 70, 80);
          gl.uniform1i(cache.plot.uniforms.u_showGrid, showGrid ? 1 : 0);
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
            logFilterBackend("FFT Radial Profile", "WebGL2",
              `samples=${samples} log=${logScale}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Radial Profile", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Radial Profile",
  func: fftRadialProfile,
  optionTypes,
  options: defaults,
  defaults,
  description: "Graph of angular-averaged power spectrum vs spatial frequency — natural images show ~1/f slope, patterned sources show sharp peaks",
  noWASM: "Needs GPU 2D FFT.",
});
