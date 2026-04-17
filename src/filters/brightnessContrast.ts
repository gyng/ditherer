import { RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

export const optionTypes = {
  brightness: { type: RANGE, range: [-255, 255], step: 1, default: 0, desc: "Additive brightness offset applied to all channels" },
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: 0, desc: "Contrast adjustment — positive increases, negative decreases" },
  exposure: { type: RANGE, range: [-4, 4], step: 0.1, default: 1, desc: "Exposure multiplier applied before contrast" },
  gamma: { type: RANGE, range: [-1.5, 7.5], step: 0.1, default: 1, desc: "Gamma correction curve (>1 darkens midtones, <1 brightens)" },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  brightness: optionTypes.brightness.default,
  contrast: optionTypes.contrast.default,
  exposure: optionTypes.exposure.default,
  gamma: optionTypes.gamma.default,
  palette: optionTypes.palette.default
};

type BrightnessContrastOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
};

const BC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_brightness;   // -255..255, applied in 0..255 space
uniform float u_contrast;     // -40..40
uniform float u_exposure;
uniform float u_gamma;
uniform int   u_linearize;
uniform float u_levels;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Matches utils.contrast: normalise around 0.5, apply cubic shaper, back.
vec3 applyContrast(vec3 c, float factor) {
  vec3 n = c - 0.5;
  return n + factor * (n - 1.0) * n * (n - 0.5) + 0.5;
}

// Matches utils.brightness: (p * exposure) + factor, all in 255 space.
vec3 applyBrightness(vec3 c, float factor, float exposure) {
  return c * exposure + factor / 255.0;
}

vec3 applyGamma(vec3 c, float g) {
  return pow(max(c, 0.0), vec3(1.0 / max(abs(g), 1e-4)));
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb = u_linearize == 1 ? srgbToLinear(c.rgb) : c.rgb;
  rgb = applyBrightness(rgb, u_brightness, u_exposure);
  rgb = applyContrast(rgb, u_contrast);
  rgb = applyGamma(rgb, u_gamma);
  if (u_linearize == 1) rgb = linearToSrgb(rgb);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { bc: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    bc: linkProgram(gl, BC_FS, [
      "u_source", "u_brightness", "u_contrast", "u_exposure",
      "u_gamma", "u_linearize", "u_levels",
    ] as const),
  };
  return _cache;
};

const brightnessContrast = (
  input: any,
  options: BrightnessContrastOptions = defaults
) => {
  const { brightness, contrast, exposure, gamma, palette } = options;
  const linearize = options._linearize === true;
  const W = input.width;
  const H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return input;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "brightnessContrast:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const identity = paletteIsIdentity(palette);
  drawPass(gl, null, W, H, cache.bc, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.bc.uniforms.u_source, 0);
    gl.uniform1f(cache.bc.uniforms.u_brightness, brightness);
    gl.uniform1f(cache.bc.uniforms.u_contrast, contrast);
    gl.uniform1f(cache.bc.uniforms.u_exposure, exposure);
    gl.uniform1f(cache.bc.uniforms.u_gamma, gamma);
    gl.uniform1i(cache.bc.uniforms.u_linearize, linearize ? 1 : 0);
    const pOpts = (palette as { options?: { levels?: number } }).options;
    gl.uniform1f(cache.bc.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Brightness/Contrast", "WebGL2",
    `${linearize ? "linearized" : "direct"}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter<BrightnessContrastOptions>({
  name: "Brightness/Contrast",
  func: brightnessContrast,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
