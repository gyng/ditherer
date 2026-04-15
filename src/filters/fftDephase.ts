import { RANGE, PALETTE } from "constants/controlTypes";
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
  finaliseIFFT,
  forwardFFT2D,
  inverseFFT2D,
} from "gl/fft2d";

// Zero the phase of every bin while keeping the magnitude. Since the FFT
// becomes real-valued and symmetric, the inverse FFT produces the image's
// autocorrelation centred at the origin — a symmetric "glow-like" halo
// where features in the source collapse into radial structure.

const DEPHASE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_amount;    // 0 = passthrough, 1 = fully dephased

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  float mag = length(c.rg);
  float phase = atan(c.g, c.r);
  float newPhase = mix(phase, 0.0, u_amount);
  fragColor = vec4(mag * cos(newPhase), mag * sin(newPhase), 0.0, 1.0);
}
`;

export const optionTypes = {
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 1, desc: "How strongly to zero the phase (0 = passthrough, 1 = full dephase → autocorrelation)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amount: optionTypes.amount.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { dephase: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    dephase: linkProgram(gl, DEPHASE_FS, ["u_input", "u_padRes", "u_amount"] as const),
  };
  return _cache;
};

const fftDephase = (input: any, options = defaults) => {
  const { amount, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftDephase:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const modified = ensureFloatTex(gl, "fftDephase:modified", fwd.paddedW, fwd.paddedH);
        if (modified) {
          drawPass(gl, modified, fwd.paddedW, fwd.paddedH, cache.dephase, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.dephase.uniforms.u_input, 0);
            gl.uniform2f(cache.dephase.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1f(cache.dephase.uniforms.u_amount, amount);
          }, vao);
          const inv = inverseFFT2D(gl, modified, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const identity = paletteIsIdentity(palette);
              const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Dephase", "WebGL2",
                  `amount=${amount}${identity ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Dephase", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Dephase",
  func: fftDephase,
  optionTypes,
  options: defaults,
  defaults,
  description: "Zero the 2D FFT's phase, keep magnitude — the inverse transform becomes the image's autocorrelation (symmetric halo of its features)",
  noWASM: "Needs GPU 2D FFT.",
});
