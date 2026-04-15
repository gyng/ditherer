import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
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

// Radial frequency mask in the (kx, ky) plane. Applies low-pass / high-pass
// / band-pass based on mode + cutoff radius. The filter works in the FFT
// domain so this replaces the current Gaussian-blur approximation in
// `frequencyFilter.ts` with an actual frequency cut.

const MODE = { LOW: "LOW", HIGH: "HIGH", BAND: "BAND" };

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Low-pass", value: MODE.LOW },
      { name: "High-pass", value: MODE.HIGH },
      { name: "Band-pass", value: MODE.BAND },
    ],
    default: MODE.HIGH,
    desc: "Which frequency band to keep — real 2D FFT mask (not a blur proxy)"
  },
  cutoff: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.15, desc: "Inner/primary radius as a fraction of Nyquist" },
  bandWidth: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.15, desc: "Band width (band-pass only) as a fraction of Nyquist" },
  softness: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Gaussian rolloff around the mask edge" },
  gain: { type: RANGE, range: [0, 4], step: 0.05, default: 1.0, desc: "Gain applied to the kept band before IFFT" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  cutoff: optionTypes.cutoff.default,
  bandWidth: optionTypes.bandWidth.default,
  softness: optionTypes.softness.default,
  gain: optionTypes.gain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Mask shader: reads a freq-domain RGBA32F texture (RG = complex), applies
// radial mask + gain, writes to another RGBA32F. The DC bin at (0, 0) gives
// max frequency at the centre of the padded image after fftshift — we
// instead compute the unshifted radial distance from (0,0) / (W,H) corners
// which matches the natural FFT layout.
const MASK_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform int   u_mode;       // 0 LOW, 1 HIGH, 2 BAND
uniform float u_cutoff;
uniform float u_bandWidth;
uniform float u_softness;
uniform float u_gain;

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);

  // Wrap the FFT coordinates so DC is at origin. For an N-wide FFT, the
  // "natural" frequency index at column k (for k < N/2) is k; otherwise it
  // is k - N (negative frequency). Distance to DC is min(k, N-k) / (N/2).
  float fx = min(x, u_padRes.x - x) / (u_padRes.x * 0.5);
  float fy = min(y, u_padRes.y - y) / (u_padRes.y * 0.5);
  float r = sqrt(fx * fx + fy * fy) / sqrt(2.0);  // normalised to [0, 1]

  float mask;
  float soft = max(u_softness, 0.001);
  if (u_mode == 0) {
    // Low-pass: pass below cutoff with smooth rolloff.
    mask = 1.0 - smoothstep(u_cutoff - soft * 0.5, u_cutoff + soft * 0.5, r);
  } else if (u_mode == 1) {
    // High-pass.
    mask = smoothstep(u_cutoff - soft * 0.5, u_cutoff + soft * 0.5, r);
  } else {
    // Band-pass — pass between cutoff and cutoff+bandWidth.
    float outer = u_cutoff + u_bandWidth;
    float lo = smoothstep(u_cutoff - soft * 0.5, u_cutoff + soft * 0.5, r);
    float hi = 1.0 - smoothstep(outer - soft * 0.5, outer + soft * 0.5, r);
    mask = lo * hi;
  }
  mask *= u_gain;

  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  fragColor = vec4(c.rg * mask, 0.0, 1.0);
}
`;

type Cache = { mask: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    mask: linkProgram(gl, MASK_FS, [
      "u_input", "u_padRes", "u_mode", "u_cutoff", "u_bandWidth", "u_softness", "u_gain",
    ] as const),
  };
  return _cache;
};

const MODE_ID: Record<string, number> = { LOW: 0, HIGH: 1, BAND: 2 };

const fftBandpass = (input: any, options = defaults) => {
  const { mode, cutoff, bandWidth, softness, gain, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftBandpass:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        // Run the frequency-domain mask into a dedicated float texture.
        const masked = ensureFloatTex(gl, "fftBandpass:masked", fwd.paddedW, fwd.paddedH);
        if (masked) {
          drawPass(gl, masked, fwd.paddedW, fwd.paddedH, cache.mask, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.mask.uniforms.u_input, 0);
            gl.uniform2f(cache.mask.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1i(cache.mask.uniforms.u_mode, MODE_ID[mode] ?? 1);
            gl.uniform1f(cache.mask.uniforms.u_cutoff, cutoff);
            gl.uniform1f(cache.mask.uniforms.u_bandWidth, bandWidth);
            gl.uniform1f(cache.mask.uniforms.u_softness, softness);
            gl.uniform1f(cache.mask.uniforms.u_gain, gain);
          }, vao);

          const inv = inverseFFT2D(gl, masked, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const isNearest = (palette as { name?: string }).name === "nearest";
              const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Bandpass", "WebGL2",
                  `${mode} cutoff=${cutoff} gain=${gain}${isNearest ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }

  // CPU fallback is a no-op passthrough — a real 2D FFT in JS is too slow
  // to be useful here. If GL isn't available the user gets the source
  // unchanged, same pattern as other FFT filters below.
  logFilterWasmStatus("FFT Bandpass", false, "needs WebGL2 + EXT_color_buffer_float");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }
  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "FFT Bandpass",
  func: fftBandpass,
  optionTypes,
  options: defaults,
  defaults,
  description: "Radial frequency mask on a real 2D FFT — low/high/band-pass via Fourier domain rather than blur proxies",
  noWASM: "2D FFT on CPU is too slow to be useful; WebGL2 + EXT_color_buffer_float is the only practical path.",
});
