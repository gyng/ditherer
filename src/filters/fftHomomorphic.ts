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
  type TexEntry,
} from "gl";
import {
  ensureFloatTex,
  fft2dAvailable,
  forwardFFT2DFromExtract,
  inverseFFT2D,
  log2Int,
  nextPow2,
} from "gl/fft2d";

// Homomorphic filter: separate illumination (low freq, multiplicative) from
// reflectance (high freq, additive) by working in log space. Flow:
//   log(image)  →  FFT  →  high-frequency emphasis mask  →  IFFT  →  exp
// Result: flat, even lighting with enhanced local contrast. Practically a
// "kill the global lighting gradient" filter.

const LOG_EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_srcRes;
uniform vec2  u_padRes;

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  if (x >= u_srcRes.x || y >= u_srcRes.y) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 suv = vec2((x + 0.5) / u_srcRes.x, 1.0 - (y + 0.5) / u_srcRes.y);
  vec3 c = texture(u_source, suv).rgb;
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  fragColor = vec4(log(lum + 0.01), 0.0, 0.0, 1.0);
}
`;

const FILTER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_lowGain;
uniform float u_highGain;
uniform float u_cutoff;
uniform float u_softness;

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  float fx = min(x, u_padRes.x - x) / (u_padRes.x * 0.5);
  float fy = min(y, u_padRes.y - y) / (u_padRes.y * 0.5);
  float r = sqrt(fx * fx + fy * fy) / sqrt(2.0);
  float t = smoothstep(u_cutoff - u_softness * 0.5, u_cutoff + u_softness * 0.5, r);
  float gain = mix(u_lowGain, u_highGain, t);
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  fragColor = vec4(c.rg * gain, 0.0, 1.0);
}
`;

const EXP_FINALISE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_fft;
uniform sampler2D u_source;
uniform vec2  u_srcRes;
uniform vec2  u_padRes;
uniform float u_invN;
uniform float u_amount;

void main() {
  vec2 px = v_uv * u_srcRes;
  float x = floor(px.x);
  float y = u_srcRes.y - 1.0 - floor(px.y);
  vec2 padUV = vec2((x + 0.5) / u_padRes.x, (y + 0.5) / u_padRes.y);
  float logLum = texture(u_fft, padUV).r * u_invN;
  float outLum = clamp(exp(logLum) - 0.01, 0.0, 1.0);
  vec2 suv = vec2((x + 0.5) / u_srcRes.x, 1.0 - (y + 0.5) / u_srcRes.y);
  vec3 src = texture(u_source, suv).rgb;
  float inLum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float ratio = inLum > 1e-4 ? outLum / inLum : outLum;
  vec3 rgb = mix(src, clamp(src * ratio, 0.0, 1.0), u_amount);
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  lowGain: { type: RANGE, range: [0, 2], step: 0.05, default: 0.3, desc: "Gain for low-frequency illumination component — lower attenuates uneven lighting" },
  highGain: { type: RANGE, range: [0, 4], step: 0.05, default: 1.8, desc: "Gain for high-frequency reflectance component — higher boosts texture / detail" },
  cutoff: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.1, desc: "Frequency cutoff between illumination and reflectance" },
  softness: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Smoothness of the cutoff transition" },
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 1, desc: "Blend between original (0) and filtered (1) image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lowGain: optionTypes.lowGain.default,
  highGain: optionTypes.highGain.default,
  cutoff: optionTypes.cutoff.default,
  softness: optionTypes.softness.default,
  amount: optionTypes.amount.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = {
  extract: Program;
  filter: Program;
  finalise: Program;
};
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    extract: linkProgram(gl, LOG_EXTRACT_FS, ["u_source", "u_srcRes", "u_padRes"] as const),
    filter: linkProgram(gl, FILTER_FS, ["u_input", "u_padRes", "u_lowGain", "u_highGain", "u_cutoff", "u_softness"] as const),
    finalise: linkProgram(gl, EXP_FINALISE_FS, ["u_fft", "u_source", "u_srcRes", "u_padRes", "u_invN", "u_amount"] as const),
  };
  return _cache;
};

const fftHomomorphic = (input: any, options = defaults) => {
  const { lowGain, highGain, cutoff, softness, amount, palette } = options;
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
      const sourceTex: TexEntry = ensureTexture(gl, "fftHomomorphic:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const paddedW = nextPow2(W);
      const paddedH = nextPow2(H);
      const logW = log2Int(paddedW);
      const logH = log2Int(paddedH);

      // 1. Log-extract into padded float texture.
      const extracted = ensureFloatTex(gl, "fftHomomorphic:extract", paddedW, paddedH);
      if (extracted) {
        drawPass(gl, extracted, paddedW, paddedH, cache.extract, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.extract.uniforms.u_source, 0);
          gl.uniform2f(cache.extract.uniforms.u_srcRes, W, H);
          gl.uniform2f(cache.extract.uniforms.u_padRes, paddedW, paddedH);
        }, vao);
        // `vao` is consumed internally by drawPass; silence the linter.
        void vao;

        // 2. Forward FFT from our log-extracted data.
        const fwd = forwardFFT2DFromExtract(gl, extracted, paddedW, paddedH);
        if (fwd) {
          // 3. Homomorphic mask (low gain below cutoff, high gain above).
          const masked = ensureFloatTex(gl, "fftHomomorphic:masked", paddedW, paddedH);
          if (masked) {
            drawPass(gl, masked, paddedW, paddedH, cache.filter, () => {
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
              gl.uniform1i(cache.filter.uniforms.u_input, 0);
              gl.uniform2f(cache.filter.uniforms.u_padRes, paddedW, paddedH);
              gl.uniform1f(cache.filter.uniforms.u_lowGain, lowGain);
              gl.uniform1f(cache.filter.uniforms.u_highGain, highGain);
              gl.uniform1f(cache.filter.uniforms.u_cutoff, cutoff);
              gl.uniform1f(cache.filter.uniforms.u_softness, softness);
            }, vao);

            // 4. Inverse FFT.
            const inv = inverseFFT2D(gl, masked, paddedW, paddedH, logW, logH);
            if (inv) {
              // 5. exp(ifft / N), scale RGB by luminance ratio.
              const invN = 1 / (paddedW * paddedH);
              drawPass(gl, null, W, H, cache.finalise, () => {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, inv.tex);
                gl.uniform1i(cache.finalise.uniforms.u_fft, 0);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
                gl.uniform1i(cache.finalise.uniforms.u_source, 1);
                gl.uniform2f(cache.finalise.uniforms.u_srcRes, W, H);
                gl.uniform2f(cache.finalise.uniforms.u_padRes, paddedW, paddedH);
                gl.uniform1f(cache.finalise.uniforms.u_invN, invN);
                gl.uniform1f(cache.finalise.uniforms.u_amount, amount);
              }, vao);

              const rendered = readoutToCanvas(canvas, W, H);
              if (rendered) {
                const identity = paletteIsIdentity(palette);
                const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
                if (out) {
                  logFilterBackend("FFT Homomorphic", "WebGL2",
                    `lowG=${lowGain} highG=${highGain} cut=${cutoff}${identity ? "" : "+palettePass"}`);
                  return out;
                }
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Homomorphic", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Homomorphic",
  func: fftHomomorphic,
  optionTypes,
  options: defaults,
  defaults,
  description: "Homomorphic filter: flatten uneven illumination while boosting local contrast. log(image) → FFT → high-freq emphasis → IFFT → exp",
  noWASM: "Needs GPU 2D FFT.",
});
