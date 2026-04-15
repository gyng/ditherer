import { ENUM, RANGE, BOOL, PALETTE } from "constants/controlTypes";
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

// Visualise the real or imaginary component of the 2D FFT. Both are signed
// (can be negative), so we use a diverging blue-grey-red colormap where
// mid-grey = zero. The magnitude plot sits next to this as the non-signed
// view; real/imag are most useful for seeing even/odd symmetry in the
// source (even symmetry → big real part, odd symmetry → big imaginary).

const COMPONENT = { REAL: "REAL", IMAGINARY: "IMAGINARY", BOTH: "BOTH" };

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform float u_scale;
uniform int   u_mode;        // 0 REAL, 1 IMAGINARY, 2 BOTH (R=re, G=im)
uniform int   u_shift;
uniform float u_levels;

vec3 diverging(float v) {
  // v in [-1, 1]. Blue → grey → red. Matches scientific "coolwarm" roughly.
  float t = clamp((v + 1.0) * 0.5, 0.0, 1.0);
  vec3 neg = vec3(33.0, 89.0, 201.0);
  vec3 mid = vec3(220.0, 220.0, 220.0);
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

  vec4 c = texelFetch(u_fft, ivec2(fx, fy), 0);
  vec3 rgb;
  if (u_mode == 2) {
    // Both: log-compress |re| and |im|, route to R and G, centre-grey for
    // small values (neither dominant).
    float re = c.r * u_scale * 0.001;
    float im = c.g * u_scale * 0.001;
    float reMag = min(abs(re), 1.0);
    float imMag = min(abs(im), 1.0);
    rgb = vec3(
      128.0 + sign(re) * reMag * 127.0,
      128.0 + sign(im) * imMag * 127.0,
      128.0
    );
  } else if (u_mode == 0) {
    rgb = diverging(c.r * u_scale * 0.001);
  } else {
    rgb = diverging(c.g * u_scale * 0.001);
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
  component: {
    type: ENUM,
    options: [
      { name: "Real part", value: COMPONENT.REAL },
      { name: "Imaginary part", value: COMPONENT.IMAGINARY },
      { name: "Both (R=re, G=im)", value: COMPONENT.BOTH },
    ],
    default: COMPONENT.REAL,
    desc: "Which component to visualise"
  },
  scale: { type: RANGE, range: [1, 10000], step: 10, default: 300, desc: "Brightness scale" },
  centred: { type: BOOL, default: true, desc: "fftshift — DC at centre" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  component: optionTypes.component.default,
  scale: optionTypes.scale.default,
  centred: optionTypes.centred.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const MODE_ID: Record<string, number> = { REAL: 0, IMAGINARY: 1, BOTH: 2 };

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, [
      "u_fft", "u_padRes", "u_outRes", "u_scale", "u_mode", "u_shift", "u_levels",
    ] as const),
  };
  return _cache;
};

const fftComponentPlot = (input: any, options = defaults) => {
  const { component, scale, centred, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftComponentPlot:source", W, H);
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
          gl.uniform1i(cache.plot.uniforms.u_mode, MODE_ID[component] ?? 0);
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
            logFilterBackend("FFT Component Plot", "WebGL2",
              `${component} scale=${scale}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Component Plot", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Component Plot",
  func: fftComponentPlot,
  optionTypes,
  options: defaults,
  defaults,
  description: "Diverging-colormap plot of the FFT's real or imaginary component (or both in R/G). Even-symmetric structure in the source shows up mostly in Re; odd-symmetric in Im",
  noWASM: "Needs GPU 2D FFT.",
});
