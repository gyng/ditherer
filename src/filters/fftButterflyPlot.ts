import { RANGE, BOOL, ENUM, PALETTE } from "constants/controlTypes";
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
import {
  fft2dAvailable,
  fft2dStageCount,
  forwardFFT2DToStage,
  nextPow2,
} from "gl/fft2d";

// Visualise an intermediate FFT stage. Stage 0 is the padded spatial
// luminance; the final stage is the fully-forward 2D FFT. In between each
// butterfly pass doubles the frequency resolution along the active axis,
// so the transform "crystallises" gradually from a spatial image into its
// full Fourier representation.

const MODE = { MAGNITUDE: "MAGNITUDE", REAL: "REAL", IMAGINARY: "IMAGINARY" };

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform int   u_mode;        // 0 magnitude (log-scaled), 1 real, 2 imaginary
uniform float u_scale;
uniform int   u_shift;
uniform float u_levels;

vec3 magCmap(float t) {
  // Viridis-like
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

// Signed diverging colormap: negative = blue, zero = grey, positive = red.
vec3 divergingCmap(float v) {
  // v expected in [-1, 1]
  float t = clamp((v + 1.0) * 0.5, 0.0, 1.0);
  vec3 neg = vec3(33.0, 89.0, 201.0);
  vec3 mid = vec3(200.0, 200.0, 200.0);
  vec3 pos = vec3(201.0, 45.0, 33.0);
  return t < 0.5 ? mix(neg, mid, t * 2.0) : mix(mid, pos, (t - 0.5) * 2.0);
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

  vec4 c = texelFetch(u_state, ivec2(fx, fy), 0);
  vec3 rgb;
  if (u_mode == 0) {
    float mag = length(c.rg);
    float t = log(1.0 + mag * u_scale) / log(1.0 + u_scale);
    rgb = magCmap(t);
  } else if (u_mode == 1) {
    // Normalise by u_scale; values outside [-1, 1] clamp at the
    // diverging extremes.
    rgb = divergingCmap(c.r * u_scale * 0.001);
  } else {
    rgb = divergingCmap(c.g * u_scale * 0.001);
  }
  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  stage: { type: RANGE, range: [0, 32], step: 1, default: 4, desc: "FFT pipeline stage to render (0 = spatial, max = fully-forward)" },
  mode: {
    type: ENUM,
    options: [
      { name: "Magnitude", value: MODE.MAGNITUDE },
      { name: "Real part", value: MODE.REAL },
      { name: "Imaginary part", value: MODE.IMAGINARY },
    ],
    default: MODE.MAGNITUDE,
    desc: "Which component of the complex state to plot"
  },
  scale: { type: RANGE, range: [1, 10000], step: 10, default: 500, desc: "Brightness scale — higher compresses dynamic range harder" },
  centred: { type: BOOL, default: true, desc: "fftshift — place DC at image centre" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  stage: optionTypes.stage.default,
  mode: optionTypes.mode.default,
  scale: optionTypes.scale.default,
  centred: optionTypes.centred.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const MODE_ID: Record<string, number> = { MAGNITUDE: 0, REAL: 1, IMAGINARY: 2 };

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, [
      "u_state", "u_padRes", "u_outRes", "u_mode", "u_scale", "u_shift", "u_levels",
    ] as const),
  };
  return _cache;
};

const fftButterflyPlot = (input: any, options = defaults) => {
  const { stage, mode, scale, centred, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftButterflyPlot:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      // Clamp requested stage to the valid range for this padded size.
      const paddedW = nextPow2(W);
      const paddedH = nextPow2(H);
      const maxStage = fft2dStageCount(paddedW, paddedH);
      const stopStage = Math.max(0, Math.min(maxStage, Math.round(stage)));

      const result = forwardFFT2DToStage(gl, sourceTex, W, H, stopStage);
      if (result) {
        drawPass(gl, null, W, H, cache.plot, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, result.tex);
          gl.uniform1i(cache.plot.uniforms.u_state, 0);
          gl.uniform2f(cache.plot.uniforms.u_padRes, result.paddedW, result.paddedH);
          gl.uniform2f(cache.plot.uniforms.u_outRes, W, H);
          gl.uniform1i(cache.plot.uniforms.u_mode, MODE_ID[mode] ?? 0);
          gl.uniform1f(cache.plot.uniforms.u_scale, scale);
          gl.uniform1i(cache.plot.uniforms.u_shift, centred ? 1 : 0);
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
            logFilterBackend("FFT Butterfly Plot", "WebGL2",
              `stage=${stopStage}/${maxStage} ${mode}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Butterfly Plot", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Butterfly Plot",
  func: fftButterflyPlot,
  optionTypes,
  options: defaults,
  defaults,
  description: "Render the FFT at any pipeline stage — watch the spatial image crystallise into its Fourier representation through the butterfly passes",
  noWASM: "Needs GPU 2D FFT.",
});
