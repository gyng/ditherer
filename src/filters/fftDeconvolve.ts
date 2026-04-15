import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
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

// Wiener deconvolution with a built-in Gaussian / motion-blur kernel. The
// frequency-domain Wiener filter is
//   W(k) = conj(H(k)) / (|H(k)|² + λ)
// where H is the blur kernel's FFT. We compute H analytically in the
// shader (Gaussian: H = exp(-π²·k²·σ²); motion: H = sinc along the blur
// axis), so there's no need to upload a kernel texture. Divide-by-zero
// gets damped by the noise λ parameter.

const KERNEL = { GAUSSIAN: "GAUSSIAN", MOTION: "MOTION" };

const WIENER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform int   u_kernel;       // 0 Gaussian, 1 motion
uniform float u_sigma;        // Gaussian radius
uniform float u_motionLen;    // Motion-blur length (px)
uniform float u_motionAngle;  // Motion-blur angle (radians)
uniform float u_noise;        // Wiener λ — damps inverse at weak freqs
uniform float u_gain;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

float gaussianH(float kx, float ky) {
  float s = u_sigma;
  // Continuous-Fourier of Gaussian: exp(-2π²·σ²·f²). We're in DFT bin
  // indices — f = k / padRes, so substitute.
  float fx = kx / u_padRes.x;
  float fy = ky / u_padRes.y;
  return exp(-2.0 * 9.8696044 * s * s * (fx * fx + fy * fy));
}

vec2 motionH(float kx, float ky) {
  // DFT of a length-L segment in direction (cosθ, sinθ) is sinc(π·L·f·d̂).
  float fx = kx / u_padRes.x;
  float fy = ky / u_padRes.y;
  float dot = fx * cos(u_motionAngle) + fy * sin(u_motionAngle);
  float arg = 3.14159265 * u_motionLen * dot;
  float sincVal = abs(arg) < 1e-5 ? 1.0 : sin(arg) / arg;
  // Motion kernel is real (even), so H is real too.
  return vec2(sincVal, 0.0);
}

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  float kx = x > u_padRes.x * 0.5 ? x - u_padRes.x : x;
  float ky = y > u_padRes.y * 0.5 ? y - u_padRes.y : y;

  vec2 H;
  if (u_kernel == 0) {
    H = vec2(gaussianH(kx, ky), 0.0);
  } else {
    H = motionH(kx, ky);
  }

  float Hmag2 = H.x * H.x + H.y * H.y;
  // Wiener: conj(H) / (|H|² + λ) — preserve DC exactly to keep mean brightness.
  vec2 conjH = vec2(H.x, -H.y);
  vec2 W = conjH / max(Hmag2 + u_noise, 1e-6);

  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  vec2 y_out = cmul(W, c.rg) * u_gain;
  if (x < 0.5 && y < 0.5) y_out = c.rg;
  fragColor = vec4(y_out, 0.0, 1.0);
}
`;

export const optionTypes = {
  kernel: {
    type: ENUM,
    options: [
      { name: "Gaussian", value: KERNEL.GAUSSIAN },
      { name: "Motion blur", value: KERNEL.MOTION },
    ],
    default: KERNEL.GAUSSIAN,
    desc: "Blur kernel to invert"
  },
  sigma: { type: RANGE, range: [0.5, 20], step: 0.1, default: 3, desc: "Gaussian σ (px) to undo" },
  motionLen: { type: RANGE, range: [1, 60], step: 1, default: 15, desc: "Motion-blur length (px)" },
  motionAngle: { type: RANGE, range: [0, 180], step: 1, default: 0, desc: "Motion-blur direction (degrees)" },
  noise: { type: RANGE, range: [0.0001, 0.5], step: 0.0001, default: 0.01, desc: "Wiener noise damping λ — higher avoids amplifying noise, lower gives sharper result" },
  gain: { type: RANGE, range: [0, 4], step: 0.05, default: 1, desc: "Output gain" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  kernel: optionTypes.kernel.default,
  sigma: optionTypes.sigma.default,
  motionLen: optionTypes.motionLen.default,
  motionAngle: optionTypes.motionAngle.default,
  noise: optionTypes.noise.default,
  gain: optionTypes.gain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const KERNEL_ID: Record<string, number> = { GAUSSIAN: 0, MOTION: 1 };

type Cache = { wiener: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    wiener: linkProgram(gl, WIENER_FS, [
      "u_input", "u_padRes", "u_kernel", "u_sigma",
      "u_motionLen", "u_motionAngle", "u_noise", "u_gain",
    ] as const),
  };
  return _cache;
};

const fftDeconvolve = (input: any, options = defaults) => {
  const { kernel, sigma, motionLen, motionAngle, noise, gain, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftDeconvolve:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const modified = ensureFloatTex(gl, "fftDeconvolve:modified", fwd.paddedW, fwd.paddedH);
        if (modified) {
          drawPass(gl, modified, fwd.paddedW, fwd.paddedH, cache.wiener, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.wiener.uniforms.u_input, 0);
            gl.uniform2f(cache.wiener.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1i(cache.wiener.uniforms.u_kernel, KERNEL_ID[kernel] ?? 0);
            gl.uniform1f(cache.wiener.uniforms.u_sigma, sigma);
            gl.uniform1f(cache.wiener.uniforms.u_motionLen, motionLen);
            gl.uniform1f(cache.wiener.uniforms.u_motionAngle, (motionAngle * Math.PI) / 180);
            gl.uniform1f(cache.wiener.uniforms.u_noise, noise);
            gl.uniform1f(cache.wiener.uniforms.u_gain, gain);
          }, vao);
          const inv = inverseFFT2D(gl, modified, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const identity = paletteIsIdentity(palette);
              const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Deconvolve", "WebGL2",
                  `${kernel} noise=${noise}${identity ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Deconvolve", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Deconvolve",
  func: fftDeconvolve,
  optionTypes,
  options: defaults,
  defaults,
  description: "Wiener deconvolution against a built-in Gaussian or motion-blur kernel — undoes blur up to the noise-damping limit",
  noWASM: "Needs GPU 2D FFT.",
});
