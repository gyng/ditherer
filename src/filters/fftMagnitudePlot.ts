import { RANGE, ENUM, BOOL, PALETTE } from "constants/controlTypes";
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

// Visualisation: render the 2D FFT log-magnitude as a false-colour image.
// Standard convention is "fftshift'd" so DC is at the centre and the
// highest spatial frequencies are at the corners/edges.

const COLORMAP = {
  VIRIDIS: "VIRIDIS", MAGMA: "MAGMA", INFERNO: "INFERNO", GRAYSCALE: "GRAYSCALE",
};
const COLORMAPS: Record<string, number[][]> = {
  [COLORMAP.VIRIDIS]: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  [COLORMAP.MAGMA]: [[0,0,4],[81,18,124],[183,55,121],[252,137,97],[252,253,191]],
  [COLORMAP.INFERNO]: [[0,0,4],[87,16,110],[188,55,84],[249,142,9],[252,255,164]],
  [COLORMAP.GRAYSCALE]: [[0,0,0],[128,128,128],[255,255,255]],
};
const MAX_STOPS = 8;

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform float u_scale;       // log-scale multiplier
uniform int   u_shift;       // 0 = raw, 1 = fftshift (DC centred)
uniform int   u_stopCount;
uniform vec3  u_stops[${MAX_STOPS}];

vec3 sampleCmap(float t) {
  float tc = clamp(t, 0.0, 1.0);
  float pos = tc * float(u_stopCount - 1);
  int idx = int(floor(pos));
  float frac = pos - float(idx);
  if (idx >= u_stopCount - 1) return u_stops[u_stopCount - 1];
  return u_stops[idx] + (u_stops[idx + 1] - u_stops[idx]) * frac;
}

void main() {
  vec2 px = v_uv * u_outRes;
  float ox = floor(px.x);
  float oy = u_outRes.y - 1.0 - floor(px.y);

  // Map output (ox, oy) → padded FFT coords (fx, fy), optionally shifted.
  float u = ox / u_outRes.x;
  float v = oy / u_outRes.y;
  float fx = floor(u * u_padRes.x);
  float fy = floor(v * u_padRes.y);
  if (u_shift == 1) {
    fx = mod(fx + u_padRes.x * 0.5, u_padRes.x);
    fy = mod(fy + u_padRes.y * 0.5, u_padRes.y);
  }

  vec4 c = texelFetch(u_fft, ivec2(fx, fy), 0);
  float mag = length(c.rg);
  // Log-scale for readability — magnitudes span many decades.
  float t = log(1.0 + mag * u_scale) / log(1.0 + u_scale);
  vec3 rgb = sampleCmap(t) / 255.0;
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  colormap: {
    type: ENUM,
    options: [
      { name: "Viridis", value: COLORMAP.VIRIDIS },
      { name: "Magma", value: COLORMAP.MAGMA },
      { name: "Inferno", value: COLORMAP.INFERNO },
      { name: "Grayscale", value: COLORMAP.GRAYSCALE },
    ],
    default: COLORMAP.VIRIDIS,
    desc: "False-colour mapping for magnitude"
  },
  scale: { type: RANGE, range: [1, 10000], step: 10, default: 1000, desc: "Log scale multiplier — higher values compress more" },
  centred: { type: BOOL, default: true, desc: "fftshift — place DC at the image centre" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  colormap: optionTypes.colormap.default,
  scale: optionTypes.scale.default,
  centred: optionTypes.centred.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { plot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    plot: linkProgram(gl, PLOT_FS, [
      "u_fft", "u_padRes", "u_outRes", "u_scale", "u_shift",
      "u_stopCount", "u_stops[0]",
    ] as const),
  };
  return _cache;
};

const fftMagnitudePlot = (input: any, options = defaults) => {
  const { colormap, scale, centred, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftMagnitudePlot:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const stops = COLORMAPS[colormap] || COLORMAPS[COLORMAP.VIRIDIS];
        const stopCount = Math.min(MAX_STOPS, stops.length);
        const flatStops = new Float32Array(MAX_STOPS * 3);
        for (let i = 0; i < stopCount; i++) {
          flatStops[i * 3] = stops[i][0];
          flatStops[i * 3 + 1] = stops[i][1];
          flatStops[i * 3 + 2] = stops[i][2];
        }
        drawPass(gl, null, W, H, cache.plot, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
          gl.uniform1i(cache.plot.uniforms.u_fft, 0);
          gl.uniform2f(cache.plot.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
          gl.uniform2f(cache.plot.uniforms.u_outRes, W, H);
          gl.uniform1f(cache.plot.uniforms.u_scale, scale);
          gl.uniform1i(cache.plot.uniforms.u_shift, centred ? 1 : 0);
          gl.uniform1i(cache.plot.uniforms.u_stopCount, stopCount);
          const loc = cache.plot.uniforms["u_stops[0]"];
          if (loc) gl.uniform3fv(loc, flatStops);
        }, vao);
        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const isNearest = (palette as { name?: string }).name === "nearest";
          const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("FFT Magnitude Plot", "WebGL2",
              `${colormap} scale=${scale}${isNearest ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Magnitude Plot", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Magnitude Plot",
  func: fftMagnitudePlot,
  optionTypes,
  options: defaults,
  defaults,
  description: "Log-magnitude visualisation of the 2D FFT — DC centred, false-colour. Horizontal/vertical streaks reveal pattern orientations in the source",
  noWASM: "Needs GPU 2D FFT.",
});
