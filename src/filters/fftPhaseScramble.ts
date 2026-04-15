import { RANGE, ACTION, PALETTE } from "constants/controlTypes";
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

// Replace each frequency bin's phase with a pseudo-random angle (seeded so
// per-frame animation works). Magnitude is preserved, so the image keeps
// its frequency signature but geometry scrambles into textural noise.

const SCRAMBLE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_amount;     // 0 = keep phase, 1 = fully random
uniform float u_seed;

float hash1(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  float re = c.r;
  float im = c.g;
  float mag = sqrt(re * re + im * im);
  float phase = atan(im, re);
  float rand = hash1(vec2(x, y), u_seed) * 6.28318530718;
  float newPhase = mix(phase, rand, u_amount);
  fragColor = vec4(mag * cos(newPhase), mag * sin(newPhase), 0.0, 1.0);
}
`;

export const optionTypes = {
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 1, desc: "Phase randomisation strength (0 = passthrough, 1 = full scramble)" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 10);
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amount: optionTypes.amount.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { scramble: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    scramble: linkProgram(gl, SCRAMBLE_FS, ["u_input", "u_padRes", "u_amount", "u_seed"] as const),
  };
  return _cache;
};

const fftPhaseScramble = (input: any, options = defaults) => {
  const { amount, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
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
      const sourceTex = ensureTexture(gl, "fftPhaseScramble:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const scrambled = ensureFloatTex(gl, "fftPhaseScramble:masked", fwd.paddedW, fwd.paddedH);
        if (scrambled) {
          drawPass(gl, scrambled, fwd.paddedW, fwd.paddedH, cache.scramble, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.scramble.uniforms.u_input, 0);
            gl.uniform2f(cache.scramble.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1f(cache.scramble.uniforms.u_amount, amount);
            gl.uniform1f(cache.scramble.uniforms.u_seed, frameIndex * 7919 + 31337);
          }, vao);

          const inv = inverseFFT2D(gl, scrambled, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const isNearest = (palette as { name?: string }).name === "nearest";
              const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Phase Scramble", "WebGL2",
                  `amount=${amount}${isNearest ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }

  logFilterWasmStatus("FFT Phase Scramble", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Phase Scramble",
  func: fftPhaseScramble,
  optionTypes,
  options: defaults,
  defaults,
  description: "Randomise the 2D FFT phase while keeping magnitude — same spectral energy, scrambled spatial structure",
  noWASM: "Real 2D FFT is only practical via GPU butterfly passes; WebGL2 + EXT_color_buffer_float required.",
});
