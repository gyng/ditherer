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
  finaliseIFFT,
  forwardFFT2D,
  inverseFFT2D,
} from "gl/fft2d";

// Pass only frequencies within ±wedge of a chosen orientation. Horizontal
// scan lines / vertical edges / diagonal weaves each live along a single
// angular direction in the 2D FFT, so a narrow wedge either isolates or
// destroys them. DC + the symmetric wedge 180° across are always included
// because the FFT of a real image is conjugate-symmetric.

const WEDGE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_angle;       // centre angle in radians
uniform float u_wedge;       // half-width of the wedge in radians
uniform float u_softness;
uniform int   u_invert;      // 0 = pass the wedge, 1 = kill the wedge
uniform float u_gain;

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  // Signed frequency index (negative for the wrap-around half).
  float kx = x > u_padRes.x * 0.5 ? x - u_padRes.x : x;
  float ky = y > u_padRes.y * 0.5 ? y - u_padRes.y : y;

  // Always keep DC.
  if (abs(kx) < 0.5 && abs(ky) < 0.5) {
    fragColor = texelFetch(u_input, ivec2(x, y), 0);
    return;
  }

  float freqAngle = atan(ky, kx);
  // Fold into [-π/2, π/2] since the FFT of a real image is 180°-symmetric;
  // a "wedge" test against ±u_angle is the same as against u_angle + π.
  float diff = freqAngle - u_angle;
  diff = atan(sin(diff), cos(diff));          // wrap to [-π, π]
  if (diff > 1.5707963) diff -= 3.1415927;    // fold 180° ambiguity
  if (diff < -1.5707963) diff += 3.1415927;

  float ad = abs(diff);
  float mask = 1.0 - smoothstep(u_wedge - u_softness * 0.5, u_wedge + u_softness * 0.5, ad);
  if (u_invert == 1) mask = 1.0 - mask;
  mask *= u_gain;

  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  fragColor = vec4(c.rg * mask, 0.0, 1.0);
}
`;

export const optionTypes = {
  angle: { type: RANGE, range: [0, 180], step: 1, default: 0, desc: "Centre angle in degrees (0 = horizontal, 90 = vertical)" },
  wedge: { type: RANGE, range: [1, 90], step: 1, default: 20, desc: "Wedge half-width in degrees" },
  softness: { type: RANGE, range: [0, 45], step: 0.5, default: 5, desc: "Smooth rolloff at the wedge edge" },
  invert: { type: BOOL, default: false, desc: "Invert — kill the wedge instead of keeping it" },
  gain: { type: RANGE, range: [0, 4], step: 0.05, default: 1, desc: "Gain applied to the kept band" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  angle: optionTypes.angle.default,
  wedge: optionTypes.wedge.default,
  softness: optionTypes.softness.default,
  invert: optionTypes.invert.default,
  gain: optionTypes.gain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { wedge: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    wedge: linkProgram(gl, WEDGE_FS, [
      "u_input", "u_padRes", "u_angle", "u_wedge", "u_softness", "u_invert", "u_gain",
    ] as const),
  };
  return _cache;
};

const fftAngularWedge = (input: any, options = defaults) => {
  const { angle, wedge, softness, invert, gain, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftAngularWedge:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const modified = ensureFloatTex(gl, "fftAngularWedge:modified", fwd.paddedW, fwd.paddedH);
        if (modified) {
          const angleRad = (angle * Math.PI) / 180;
          const wedgeRad = (wedge * Math.PI) / 180;
          const softnessRad = (softness * Math.PI) / 180;
          drawPass(gl, modified, fwd.paddedW, fwd.paddedH, cache.wedge, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.wedge.uniforms.u_input, 0);
            gl.uniform2f(cache.wedge.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1f(cache.wedge.uniforms.u_angle, angleRad);
            gl.uniform1f(cache.wedge.uniforms.u_wedge, wedgeRad);
            gl.uniform1f(cache.wedge.uniforms.u_softness, softnessRad);
            gl.uniform1i(cache.wedge.uniforms.u_invert, invert ? 1 : 0);
            gl.uniform1f(cache.wedge.uniforms.u_gain, gain);
          }, vao);
          const inv = inverseFFT2D(gl, modified, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const identity = paletteIsIdentity(palette);
              const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Angular Wedge", "WebGL2",
                  `angle=${angle} wedge=${wedge} ${invert ? "kill" : "keep"}${identity ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Angular Wedge", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Angular Wedge",
  func: fftAngularWedge,
  optionTypes,
  options: defaults,
  defaults,
  description: "Keep or kill only the FFT bins within a wedge of angles — isolates directional patterns (horizontal lines, diagonal weaves) or removes them while leaving everything else intact",
  noWASM: "Needs GPU 2D FFT.",
});
