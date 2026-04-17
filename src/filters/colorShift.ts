import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
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
  hue: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Hue rotation in degrees" },
  saturation: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Saturation adjustment" },
  value: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Brightness/value adjustment" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  hue: optionTypes.hue.default,
  saturation: optionTypes.saturation.default,
  value: optionTypes.value.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_hue;          // degrees
uniform float u_saturation;   // -1..1 additive
uniform float u_value;        // -1..1 additive
uniform float u_levels;

// RGB (0..1) → HSV (h in degrees, s/v in 0..1) matching utils.rgba2hsva.
vec3 rgb2hsv(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-5) {
    if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else                h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  float s = mx > 1e-5 ? d / mx : 0.0;
  return vec3(h, s, mx);
}

// HSV → RGB matching the JS hsva2rgba sector switch.
vec3 hsv2rgb(float h, float s, float v) {
  if (s == 0.0) return vec3(v);
  float hh = mod(mod(h, 360.0) + 360.0, 360.0) / 60.0;
  float sector = floor(hh);
  float f = hh - sector;
  float p = v * (1.0 - s);
  float q = v * (1.0 - s * f);
  float t = v * (1.0 - s * (1.0 - f));
  if (sector < 1.0) return vec3(v, t, p);
  if (sector < 2.0) return vec3(q, v, p);
  if (sector < 3.0) return vec3(p, v, t);
  if (sector < 4.0) return vec3(p, q, v);
  if (sector < 5.0) return vec3(t, p, v);
  return vec3(v, p, q);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);
  float h = hsv.x + u_hue;
  float s = clamp(hsv.y + u_saturation, 0.0, 1.0);
  float v = clamp(hsv.z + u_value, 0.0, 1.0);
  vec3 rgb = hsv2rgb(h, s, v);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { cs: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cs: linkProgram(gl, CS_FS, [
      "u_source", "u_hue", "u_saturation", "u_value", "u_levels",
    ] as const),
  };
  return _cache;
};

const colorShift = (input: any, options: typeof defaults = defaults) => {
  const { hue, saturation, value, palette } = options;
  const W = input.width;
  const H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return input;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "colorShift:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const identity = paletteIsIdentity(palette);
  drawPass(gl, null, W, H, cache.cs, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.cs.uniforms.u_source, 0);
    gl.uniform1f(cache.cs.uniforms.u_hue, hue);
    gl.uniform1f(cache.cs.uniforms.u_saturation, saturation);
    gl.uniform1f(cache.cs.uniforms.u_value, value);
    const pOpts = (palette as { options?: { levels?: number } }).options;
    gl.uniform1f(cache.cs.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Color shift", "WebGL2", `hsv${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Color shift",
  func: colorShift,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
