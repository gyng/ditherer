import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
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
  radius: { type: RANGE, range: [1, 12], step: 1, default: 4, desc: "Brush stroke radius" },
  levels: { type: RANGE, range: [4, 30], step: 1, default: 20, desc: "Color quantization levels for paint effect" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  levels: optionTypes.levels.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Per-pixel luminance histogram over the neighborhood — each bin
// accumulates (R, G, B, count). Pick the most populated bin and emit its
// average colour. Fragment shaders support dynamic indexing into fixed-size
// arrays in GLSL ES 3.00, so we keep a vec4[30] on the stack and walk it
// through the neighbourhood.
const OIL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;
uniform int   u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // (R*255, G*255, B*255, count) per bin.
  vec4 bins[30];
  for (int i = 0; i < 30; i++) bins[i] = vec4(0.0);

  for (int ky = -12; ky <= 12; ky++) {
    if (ky < -u_radius || ky > u_radius) continue;
    for (int kx = -12; kx <= 12; kx++) {
      if (kx < -u_radius || kx > u_radius) continue;
      float nx = clamp(x + float(kx), 0.0, u_res.x - 1.0);
      float ny = clamp(y + float(ky), 0.0, u_res.y - 1.0);
      vec2 uv = vec2((nx + 0.5) / u_res.x, 1.0 - (ny + 0.5) / u_res.y);
      vec3 c = texture(u_source, uv).rgb;
      float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      int bin = int(clamp(floor(lum * float(u_levels)), 0.0, float(u_levels - 1)));
      bins[bin] += vec4(c * 255.0, 1.0);
    }
  }

  int maxBin = 0;
  float maxCount = bins[0].w;
  for (int b = 1; b < 30; b++) {
    if (b >= u_levels) break;
    if (bins[b].w > maxCount) {
      maxCount = bins[b].w;
      maxBin = b;
    }
  }

  vec4 pick = bins[0];
  for (int b = 0; b < 30; b++) {
    if (b == maxBin) pick = bins[b];
  }

  vec3 rgb;
  if (pick.w < 0.5) {
    vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
    rgb = texture(u_source, suv).rgb;
  } else {
    rgb = (pick.rgb / pick.w) / 255.0;
  }
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float a = texture(u_source, suv).a;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

type Cache = { oil: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    oil: linkProgram(gl, OIL_FS, [
      "u_source", "u_res", "u_radius", "u_levels",
    ] as const),
  };
  return _cache;
};

const oilPainting = (input: any, options: typeof defaults = defaults) => {
  const { radius, levels, palette } = options;
  const W = input.width;
  const H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return input;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "oilPainting:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  drawPass(gl, null, W, H, cache.oil, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.oil.uniforms.u_source, 0);
    gl.uniform2f(cache.oil.uniforms.u_res, W, H);
    gl.uniform1i(cache.oil.uniforms.u_radius, Math.max(1, Math.min(12, Math.round(radius))));
    gl.uniform1i(cache.oil.uniforms.u_levels, Math.max(4, Math.min(30, Math.round(levels))));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Oil Painting", "WebGL2",
    `r=${radius} lvl=${levels}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Oil Painting",
  func: oilPainting,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
