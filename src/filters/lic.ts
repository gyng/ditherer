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

// Line Integral Convolution: visualise the gradient-tangent flow field by
// convolving a high-frequency noise texture along each pixel's streamline.
// Classic flow visualisation, produces a velvety silk-like look that traces
// out the image's edge flow.

const LIC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_length;     // half-length of the streamline (px)
uniform int   u_steps;      // number of integration samples per direction
uniform float u_contrast;
uniform int   u_colorFromSource;
uniform float u_levels;
uniform float u_seed;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec2 tangent(vec2 uv, vec2 px) {
  float l = lum(texture(u_source, uv - vec2(px.x, 0.0)).rgb);
  float r = lum(texture(u_source, uv + vec2(px.x, 0.0)).rgb);
  float d = lum(texture(u_source, uv - vec2(0.0, px.y)).rgb);
  float t = lum(texture(u_source, uv + vec2(0.0, px.y)).rgb);
  vec2 g = vec2(r - l, t - d);
  // Tangent perpendicular to gradient — direction of constant brightness.
  vec2 v = vec2(-g.y, g.x);
  float m = length(v);
  return m > 1e-5 ? v / m : vec2(1.0, 0.0);
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec2 onePx = 1.0 / u_res;

  // Forward integration via midpoint method.
  vec2 pos = suv;
  float sum = 0.0;
  float w = 0.0;
  float dtStep = u_length / float(u_steps);
  for (int i = 0; i < 64; i++) {
    if (i >= u_steps) break;
    vec2 tg = tangent(pos, onePx);
    pos += tg * dtStep * onePx;
    pos = clamp(pos, vec2(0.0), vec2(1.0));
    float n = hash(floor(pos * u_res) + vec2(u_seed));
    float k = 1.0 - float(i) / float(u_steps);
    sum += n * k; w += k;
  }
  // Backward integration.
  pos = suv;
  for (int i = 0; i < 64; i++) {
    if (i >= u_steps) break;
    vec2 tg = tangent(pos, onePx);
    pos -= tg * dtStep * onePx;
    pos = clamp(pos, vec2(0.0), vec2(1.0));
    float n = hash(floor(pos * u_res) + vec2(u_seed));
    float k = 1.0 - float(i) / float(u_steps);
    sum += n * k; w += k;
  }

  float licVal = sum / max(w, 1e-5);
  licVal = clamp((licVal - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  vec3 rgb;
  if (u_colorFromSource == 1) {
    vec3 src = texture(u_source, suv).rgb;
    rgb = src * (0.6 + 0.8 * licVal);
  } else {
    rgb = vec3(licVal);
  }
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  length: { type: RANGE, range: [2, 60], step: 1, default: 16, desc: "Streamline length in pixels" },
  steps: { type: RANGE, range: [4, 64], step: 1, default: 24, desc: "Integration samples per direction" },
  contrast: { type: RANGE, range: [0.5, 4], step: 0.1, default: 2.0, desc: "LIC output contrast" },
  colorFromSource: { type: BOOL, default: true, desc: "Modulate the source image by LIC — off = pure monochrome silk" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  length: optionTypes.length.default,
  steps: optionTypes.steps.default,
  contrast: optionTypes.contrast.default,
  colorFromSource: optionTypes.colorFromSource.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { lic: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    lic: linkProgram(gl, LIC_FS, [
      "u_source", "u_res", "u_length", "u_steps",
      "u_contrast", "u_colorFromSource", "u_levels", "u_seed",
    ] as const),
  };
  return _cache;
};

const lic = (input: any, options = defaults) => {
  const { length, steps, contrast, colorFromSource, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "lic:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.lic, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.lic.uniforms.u_source, 0);
        gl.uniform2f(cache.lic.uniforms.u_res, W, H);
        gl.uniform1f(cache.lic.uniforms.u_length, length);
        gl.uniform1i(cache.lic.uniforms.u_steps, Math.max(4, Math.min(64, Math.round(steps))));
        gl.uniform1f(cache.lic.uniforms.u_contrast, contrast);
        gl.uniform1i(cache.lic.uniforms.u_colorFromSource, colorFromSource ? 1 : 0);
        gl.uniform1f(cache.lic.uniforms.u_seed, 7.0);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.lic.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Line Integral Convolution", "WebGL2",
            `len=${length} steps=${steps}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Line Integral Convolution", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Line Integral Convolution",
  func: lic,
  optionTypes,
  options: defaults,
  defaults,
  description: "Line Integral Convolution — convolve noise along the gradient-tangent flow field, revealing the image's edge flow as silky directional streaks",
  noWASM: "Per-pixel streamline integration needs the GPU to stay interactive.",
});
