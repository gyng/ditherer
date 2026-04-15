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
import {
  ensureFloatTex,
  fft2dAvailable,
  forwardFFT2D,
  inverseFFT2D,
  nextPow2,
  log2Int,
} from "gl/fft2d";

// Cepstrum: inverse FFT of log |FFT(x)|. Periodicities / echoes in the
// source show up as distinct peaks in the cepstrum — commonly used in
// speech analysis to find pitch and vocal-tract resonances. For images,
// it surfaces repeating patterns (weaves, periodic dots) as discrete
// bright points whose position is the pattern's spatial period.

const LOG_MAG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;

void main() {
  vec2 px = v_uv * u_padRes;
  int x = int(floor(px.x));
  int y = int(floor(px.y));
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  float mag = length(c.rg);
  // log(1 + |X|) so zero-mag bins stay finite; cepstrum pipeline inputs
  // the real part so G stays 0 (real-valued input to IFFT).
  fragColor = vec4(log(1.0 + mag), 0.0, 0.0, 1.0);
}
`;

const PLOT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cepstrum;
uniform vec2  u_padRes;
uniform vec2  u_outRes;
uniform float u_invN;
uniform float u_scale;
uniform int   u_shift;
uniform int   u_suppressDC;
uniform float u_levels;

vec3 magCmap(float t) {
  vec3 a = vec3(0.0, 0.0, 4.0);
  vec3 b = vec3(81.0, 18.0, 124.0);
  vec3 c = vec3(183.0, 55.0, 121.0);
  vec3 d = vec3(252.0, 137.0, 97.0);
  vec3 e = vec3(252.0, 253.0, 191.0);
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

  float u = ox / u_outRes.x;
  float v = oy / u_outRes.y;
  float fx = floor(u * u_padRes.x);
  float fy = floor(v * u_padRes.y);
  if (u_shift == 1) {
    fx = mod(fx + u_padRes.x * 0.5, u_padRes.x);
    fy = mod(fy + u_padRes.y * 0.5, u_padRes.y);
  }

  vec4 c = texelFetch(u_cepstrum, ivec2(fx, fy), 0);
  float cep = abs(c.r * u_invN);
  // Suppress the DC / low-quefrency region so repeating-pattern peaks
  // stand out instead of the usual bright-centre glare.
  if (u_suppressDC == 1) {
    float cxShift = u_padRes.x * 0.5;
    float cyShift = u_padRes.y * 0.5;
    float rx = fx - cxShift;
    float ry = fy - cyShift;
    float rad = sqrt(rx * rx + ry * ry);
    float attn = smoothstep(2.0, 10.0, rad);
    cep *= attn;
  }
  float t = log(1.0 + cep * u_scale) / log(1.0 + u_scale);
  vec3 rgb = magCmap(t) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  scale: { type: RANGE, range: [1, 10000], step: 10, default: 200, desc: "Brightness scale" },
  centred: { type: BOOL, default: true, desc: "Centre DC of the cepstrum (the origin = repeating-period 0)" },
  suppressDC: { type: BOOL, default: true, desc: "Dim the DC region so pattern peaks dominate instead of the usual bright centre" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  centred: optionTypes.centred.default,
  suppressDC: optionTypes.suppressDC.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = {
  logMag: Program;
  plot: Program;
};
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    logMag: linkProgram(gl, LOG_MAG_FS, ["u_input", "u_padRes"] as const),
    plot: linkProgram(gl, PLOT_FS, [
      "u_cepstrum", "u_padRes", "u_outRes", "u_invN", "u_scale",
      "u_shift", "u_suppressDC", "u_levels",
    ] as const),
  };
  return _cache;
};

const fftCepstrum = (input: any, options = defaults) => {
  const { scale, centred, suppressDC, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftCepstrum:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        // Compute log|X| into a fresh float texture.
        const paddedW = nextPow2(W);
        const paddedH = nextPow2(H);
        const logTex = ensureFloatTex(gl, "fftCepstrum:logMag", paddedW, paddedH);
        if (logTex) {
          drawPass(gl, logTex, paddedW, paddedH, cache.logMag, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.logMag.uniforms.u_input, 0);
            gl.uniform2f(cache.logMag.uniforms.u_padRes, paddedW, paddedH);
          }, vao);

          // IFFT of log|X| — the cepstrum.
          const logW = log2Int(paddedW);
          const logH = log2Int(paddedH);
          const ceps = inverseFFT2D(gl, logTex, paddedW, paddedH, logW, logH);
          if (ceps) {
            const invN = 1 / (paddedW * paddedH);
            drawPass(gl, null, W, H, cache.plot, () => {
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, ceps.tex);
              gl.uniform1i(cache.plot.uniforms.u_cepstrum, 0);
              gl.uniform2f(cache.plot.uniforms.u_padRes, paddedW, paddedH);
              gl.uniform2f(cache.plot.uniforms.u_outRes, W, H);
              gl.uniform1f(cache.plot.uniforms.u_invN, invN);
              gl.uniform1f(cache.plot.uniforms.u_scale, scale);
              gl.uniform1i(cache.plot.uniforms.u_shift, centred ? 1 : 0);
              gl.uniform1i(cache.plot.uniforms.u_suppressDC, suppressDC ? 1 : 0);
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
                logFilterBackend("FFT Cepstrum", "WebGL2",
                  `scale=${scale} shift=${centred}${identity ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Cepstrum", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Cepstrum",
  func: fftCepstrum,
  optionTypes,
  options: defaults,
  defaults,
  description: "Cepstrum = inverse FFT of log |FFT|. Repeating patterns / echoes show up as discrete bright points at their spatial period",
  noWASM: "Needs GPU 2D FFT.",
});
