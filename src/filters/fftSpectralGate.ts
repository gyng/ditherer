import { RANGE, PALETTE } from "constants/controlTypes";
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
import {
  ensureFloatTex,
  fft2dAvailable,
  finaliseIFFT,
  forwardFFT2D,
  inverseFFT2D,
} from "gl/fft2d";

// Spectral gate: keep only frequency bins whose magnitude exceeds a
// threshold (relative to the DC magnitude). Drops weak components,
// amplifying the dominant structure. "Frequency-domain denoise / strong-edge
// preserver."

const GATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_threshold;
uniform float u_dcMag;
uniform float u_softness;

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  float mag = length(c.rg);
  float rel = mag / max(u_dcMag, 1e-6);
  // Always keep DC exactly (bin at 0,0) so global brightness is preserved.
  if (x < 0.5 && y < 0.5) {
    fragColor = vec4(c.rg, 0.0, 1.0);
    return;
  }
  float keep = smoothstep(u_threshold - u_softness * 0.5, u_threshold + u_softness * 0.5, rel);
  fragColor = vec4(c.rg * keep, 0.0, 1.0);
}
`;

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 0.2], step: 0.001, default: 0.02, desc: "Minimum magnitude (relative to DC) to keep" },
  softness: { type: RANGE, range: [0, 0.2], step: 0.001, default: 0.005, desc: "Smoothstep rolloff around the gate" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  softness: optionTypes.softness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { gate: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    gate: linkProgram(gl, GATE_FS, ["u_input", "u_padRes", "u_threshold", "u_dcMag", "u_softness"] as const),
  };
  return _cache;
};

const fftSpectralGate = (input: any, options = defaults) => {
  const { threshold, softness, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftSpectralGate:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        // Read the DC bin so the shader can normalise relative to it.
        // texelFetch in JS: bind FBO, readPixels at (0, 0).
        const dcPixel = new Float32Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fwd.fbo);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, dcPixel);
        const dcMag = Math.hypot(dcPixel[0], dcPixel[1]);
        const masked = ensureFloatTex(gl, "fftSpectralGate:masked", fwd.paddedW, fwd.paddedH);
        if (masked) {
          drawPass(gl, masked, fwd.paddedW, fwd.paddedH, cache.gate, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.gate.uniforms.u_input, 0);
            gl.uniform2f(cache.gate.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1f(cache.gate.uniforms.u_threshold, threshold);
            gl.uniform1f(cache.gate.uniforms.u_dcMag, dcMag);
            gl.uniform1f(cache.gate.uniforms.u_softness, softness);
          }, vao);
          const inv = inverseFFT2D(gl, masked, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const isNearest = (palette as { name?: string }).name === "nearest";
              const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Spectral Gate", "WebGL2",
                  `threshold=${threshold}${isNearest ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Spectral Gate", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Spectral Gate",
  func: fftSpectralGate,
  optionTypes,
  options: defaults,
  defaults,
  description: "Keep only frequency bins above a threshold relative to DC — frequency-domain denoise that preserves dominant structure",
  noWASM: "Real 2D FFT is only practical via GPU butterfly passes.",
});
