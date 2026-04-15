import { BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "utils";
import { applyPalettePassToCanvas } from "palettes/backend";
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

// Phase-angle visualisation: map atan2(im, re) ∈ [-π, π] to hue via HSV.
// Darkness = low magnitude (so noise floor bins don't dominate).

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform int   u_shift;
uniform int   u_weighted;
uniform float u_levels;

vec3 hsv2rgb(vec3 hsv) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(vec3(hsv.x) + K.xyz) * 6.0 - vec3(K.w));
  return hsv.z * mix(vec3(K.x), clamp(p - vec3(K.x), 0.0, 1.0), hsv.y);
}

void main() {
  vec2 px = v_uv * u_outRes;
  float ox = floor(px.x);
  float oy = u_outRes.y - 1.0 - floor(px.y);

  float u = ox / u_outRes.x;
  float v = oy / u_outRes.y;
  float fx = floor(u * u_padRes.x);
  float fy = floor(v * u_padRes.y);
  if (u_shift == 1) {
    fx = mod(fx + u_padRes.x * 0.5, u_padRes.x);
    fy = mod(fy + u_padRes.y * 0.5, u_padRes.y);
  }

  vec4 c = texelFetch(u_fft, ivec2(fx, fy), 0);
  float phase = atan(c.g, c.r);
  float hue = phase / 6.28318530718 + 0.5;  // [0, 1]

  float val = 1.0;
  if (u_weighted == 1) {
    float mag = length(c.rg);
    // Log-compress magnitude to modulate value. Centre around ~0.5 so
    // most bins are visible instead of washing out to white.
    val = clamp(log(1.0 + mag * 100.0) / log(101.0), 0.0, 1.0);
  }

  vec3 rgb = hsv2rgb(vec3(hue, 0.9, val));
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  centred: { type: BOOL, default: true, desc: "fftshift — place DC at the image centre" },
  weightByMagnitude: { type: BOOL, default: true, desc: "Dim low-magnitude bins so noise floor phase doesn't dominate" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  centred: optionTypes.centred.default,
  weightByMagnitude: optionTypes.weightByMagnitude.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, ["u_fft", "u_padRes", "u_outRes", "u_shift", "u_weighted", "u_levels"] as const),
  };
  return _cache;
};

const fftPhasePlot = (input: any, options = defaults) => {
  const { centred, weightByMagnitude, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftPhasePlot:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        drawPass(gl, null, W, H, cache.plot, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
          gl.uniform1i(cache.plot.uniforms.u_fft, 0);
          gl.uniform2f(cache.plot.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
          gl.uniform2f(cache.plot.uniforms.u_outRes, W, H);
          gl.uniform1i(cache.plot.uniforms.u_shift, centred ? 1 : 0);
          gl.uniform1i(cache.plot.uniforms.u_weighted, weightByMagnitude ? 1 : 0);
          const isNearestUniform = (palette as { name?: string }).name === "nearest";
          const levels = isNearestUniform
            ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256)
            : 256;
          gl.uniform1f(cache.plot.uniforms.u_levels, levels);
        }, vao);
        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const isNearest = (palette as { name?: string }).name === "nearest";
          const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("FFT Phase Plot", "WebGL2",
              `${weightByMagnitude ? "weighted" : "raw"}${isNearest ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Phase Plot", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Phase Plot",
  func: fftPhasePlot,
  optionTypes,
  options: defaults,
  defaults,
  description: "Hue-mapped phase of the 2D FFT — shows orientation/direction of frequency components",
  noWASM: "Needs GPU 2D FFT.",
});
