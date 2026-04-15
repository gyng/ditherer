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

// The "phase only" reconstruction: set every bin's magnitude to 1 (or
// `gain`) and keep the phase. Classic Oppenheim demo — turns out most of
// the image's *structure* lives in the phase, so the inverse looks like
// a harsh, flattened version of the original with strong edges and no
// smooth tonal areas. DC is preserved so we don't black-out the image.

const PHASE_ONLY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_gain;
uniform float u_amount;     // 0 = passthrough, 1 = pure phase-only

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  float mag = length(c.rg);
  float phase = atan(c.g, c.r);

  // Preserve DC so the mean brightness survives.
  if (x < 0.5 && y < 0.5) {
    fragColor = vec4(c.rg, 0.0, 1.0);
    return;
  }

  float newMag = mix(mag, u_gain, u_amount);
  fragColor = vec4(newMag * cos(phase), newMag * sin(phase), 0.0, 1.0);
}
`;

export const optionTypes = {
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 1, desc: "Blend between original magnitudes (0) and uniform magnitude (1)" },
  gain: { type: RANGE, range: [0.1, 50], step: 0.1, default: 10, desc: "Target magnitude for all non-DC bins" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amount: optionTypes.amount.default,
  gain: optionTypes.gain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { phaseOnly: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    phaseOnly: linkProgram(gl, PHASE_ONLY_FS, ["u_input", "u_padRes", "u_gain", "u_amount"] as const),
  };
  return _cache;
};

const fftPhaseOnly = (input: any, options = defaults) => {
  const { amount, gain, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftPhaseOnly:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const modified = ensureFloatTex(gl, "fftPhaseOnly:modified", fwd.paddedW, fwd.paddedH);
        if (modified) {
          drawPass(gl, modified, fwd.paddedW, fwd.paddedH, cache.phaseOnly, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.phaseOnly.uniforms.u_input, 0);
            gl.uniform2f(cache.phaseOnly.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1f(cache.phaseOnly.uniforms.u_gain, gain);
            gl.uniform1f(cache.phaseOnly.uniforms.u_amount, amount);
          }, vao);
          const inv = inverseFFT2D(gl, modified, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const identity = paletteIsIdentity(palette);
              const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Phase Only", "WebGL2",
                  `amount=${amount} gain=${gain}${identity ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Phase Only", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Phase Only",
  func: fftPhaseOnly,
  optionTypes,
  options: defaults,
  defaults,
  description: "Keep the FFT phase, replace all magnitudes with a constant — classic demo that phase carries most of the image's structure",
  noWASM: "Needs GPU 2D FFT.",
});
