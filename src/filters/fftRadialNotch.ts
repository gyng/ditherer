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

// Kill a circular ring in frequency space — useful for removing regular
// patterns (scan lines, dot screens, weave).

const NOTCH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_padRes;
uniform float u_radius;
uniform float u_width;
uniform float u_depth;      // 0 = notch fully kills (1 - multiplier); 1 = passthrough

void main() {
  vec2 px = v_uv * u_padRes;
  float x = floor(px.x);
  float y = floor(px.y);
  float fx = min(x, u_padRes.x - x) / (u_padRes.x * 0.5);
  float fy = min(y, u_padRes.y - y) / (u_padRes.y * 0.5);
  float r = sqrt(fx * fx + fy * fy) / sqrt(2.0);

  float hw = u_width * 0.5;
  float inside = smoothstep(u_radius - hw, u_radius, r)
               * (1.0 - smoothstep(u_radius, u_radius + hw, r));
  float mask = 1.0 - inside * (1.0 - u_depth);
  vec4 c = texelFetch(u_input, ivec2(x, y), 0);
  fragColor = vec4(c.rg * mask, 0.0, 1.0);
}
`;

export const optionTypes = {
  radius: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.3, desc: "Ring centre as a fraction of Nyquist" },
  width: { type: RANGE, range: [0.005, 0.5], step: 0.005, default: 0.06, desc: "Ring width" },
  depth: { type: RANGE, range: [0, 1], step: 0.01, default: 0, desc: "Depth — 0 fully kills the ring, 1 passes it through" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  width: optionTypes.width.default,
  depth: optionTypes.depth.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type Cache = { notch: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    notch: linkProgram(gl, NOTCH_FS, ["u_input", "u_padRes", "u_radius", "u_width", "u_depth"] as const),
  };
  return _cache;
};

const fftRadialNotch = (input: any, options = defaults) => {
  const { radius, width, depth, palette } = options;
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
      const sourceTex = ensureTexture(gl, "fftRadialNotch:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const fwd = forwardFFT2D(gl, sourceTex, W, H);
      if (fwd) {
        const masked = ensureFloatTex(gl, "fftRadialNotch:masked", fwd.paddedW, fwd.paddedH);
        if (masked) {
          drawPass(gl, masked, fwd.paddedW, fwd.paddedH, cache.notch, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fwd.tex);
            gl.uniform1i(cache.notch.uniforms.u_input, 0);
            gl.uniform2f(cache.notch.uniforms.u_padRes, fwd.paddedW, fwd.paddedH);
            gl.uniform1f(cache.notch.uniforms.u_radius, radius);
            gl.uniform1f(cache.notch.uniforms.u_width, width);
            gl.uniform1f(cache.notch.uniforms.u_depth, depth);
          }, vao);
          const inv = inverseFFT2D(gl, masked, fwd.paddedW, fwd.paddedH, fwd.logW, fwd.logH);
          if (inv) {
            finaliseIFFT(gl, inv, sourceTex, W, H, fwd.paddedW, fwd.paddedH, W, H);
            const rendered = readoutToCanvas(canvas, W, H);
            if (rendered) {
              const isNearest = (palette as { name?: string }).name === "nearest";
              const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
              if (out) {
                logFilterBackend("FFT Radial Notch", "WebGL2",
                  `radius=${radius} width=${width}${isNearest ? "" : "+palettePass"}`);
                return out;
              }
            }
          }
        }
      }
    }
  }
  logFilterWasmStatus("FFT Radial Notch", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "FFT Radial Notch",
  func: fftRadialNotch,
  optionTypes,
  options: defaults,
  defaults,
  description: "Zero out a circular ring in the 2D FFT — kills periodic artefacts like scan lines, dot screens, weaves",
  noWASM: "Real 2D FFT is only practical via GPU butterfly passes.",
});
