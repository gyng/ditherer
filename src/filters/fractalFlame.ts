import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
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

// Per-pixel fractal-flame-style variations: for each output pixel, apply
// a chosen IFS variation to its UV coordinates, then sample the source.
// This isn't Scott Draves's actual point-iteration flame (we can't
// accumulate onto a density buffer without transform-feedback / compute),
// but the variations themselves give the recognisable swirled/pinched
// flame aesthetic when composited with the source image. Multi-tap
// accumulation across several variations produces the characteristic
// layered look.

const FLAME_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_variation;   // 0 Sinusoidal, 1 Spherical, 2 Swirl, 3 Horseshoe, 4 Polar, 5 Heart, 6 Disc, 7 Hyperbolic
uniform float u_amount;
uniform float u_zoom;
uniform float u_rotate;
uniform int   u_taps;        // number of rotated samples to accumulate
uniform vec3  u_tint;
uniform float u_levels;

vec2 variation(vec2 p, int v) {
  float r = length(p);
  float theta = atan(p.y, p.x);
  if (v == 0) return sin(p);
  if (v == 1) return p / (r * r + 1e-4);
  if (v == 2) return vec2(p.x * sin(r * r) - p.y * cos(r * r), p.x * cos(r * r) + p.y * sin(r * r));
  if (v == 3) return (1.0 / (r + 1e-4)) * vec2((p.x - p.y) * (p.x + p.y), 2.0 * p.x * p.y);
  if (v == 4) return vec2(theta / 3.14159, r - 1.0);
  if (v == 5) return r * vec2(sin(theta * r), -cos(theta * r));
  if (v == 6) return (theta / 3.14159) * vec2(sin(3.14159 * r), cos(3.14159 * r));
  return vec2(sin(theta) / max(r, 1e-4), cos(theta) * r);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 uv = vec2(x, y) / u_res;

  // Map to centred [-1, 1] with aspect preserved.
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (uv - 0.5) * 2.0 * aspect / u_zoom;

  vec3 accum = vec3(0.0);
  float wSum = 0.0;
  float rot = u_rotate;
  int taps = int(clamp(float(u_taps), 1.0, 8.0));
  for (int i = 0; i < 8; i++) {
    if (i >= taps) break;
    float a = rot + float(i) * 6.2831853 / float(taps);
    float ca = cos(a), sa = sin(a);
    vec2 pr = mat2(ca, -sa, sa, ca) * p;
    vec2 warped = mix(pr, variation(pr, u_variation), u_amount);
    vec2 unrot = mat2(ca, sa, -sa, ca) * warped;
    vec2 back = unrot / aspect / 2.0 + 0.5;
    back = clamp(back, vec2(0.0), vec2(1.0));
    // Flip Y for JS-y source sampling.
    vec3 sampleC = texture(u_source, vec2(back.x, 1.0 - back.y)).rgb;
    float w = 1.0 / float(taps);
    accum += sampleC * w;
    wSum += w;
  }
  vec3 rgb = accum / max(wSum, 1e-4);
  // Tint the mean toward flame palette.
  float L = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  rgb = mix(rgb, u_tint / 255.0 * (0.4 + L), 0.25);
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

const VAR = {
  SINUSOIDAL: "SINUSOIDAL", SPHERICAL: "SPHERICAL", SWIRL: "SWIRL",
  HORSESHOE: "HORSESHOE", POLAR: "POLAR", HEART: "HEART",
  DISC: "DISC", HYPERBOLIC: "HYPERBOLIC",
};
const VAR_ID: Record<string, number> = {
  SINUSOIDAL: 0, SPHERICAL: 1, SWIRL: 2, HORSESHOE: 3,
  POLAR: 4, HEART: 5, DISC: 6, HYPERBOLIC: 7,
};

export const optionTypes = {
  variation: {
    type: ENUM,
    options: [
      { name: "Sinusoidal", value: VAR.SINUSOIDAL },
      { name: "Spherical", value: VAR.SPHERICAL },
      { name: "Swirl", value: VAR.SWIRL },
      { name: "Horseshoe", value: VAR.HORSESHOE },
      { name: "Polar", value: VAR.POLAR },
      { name: "Heart", value: VAR.HEART },
      { name: "Disc", value: VAR.DISC },
      { name: "Hyperbolic", value: VAR.HYPERBOLIC },
    ],
    default: VAR.SWIRL,
    desc: "IFS variation to apply — each produces a distinct fractal-flame warp"
  },
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.9, desc: "Variation strength (0 = passthrough)" },
  zoom: { type: RANGE, range: [0.3, 4], step: 0.05, default: 1.2, desc: "Zoom into the variation field" },
  rotate: { type: RANGE, range: [0, 6.2831], step: 0.01, default: 0, desc: "Rotate before / after the variation" },
  taps: { type: RANGE, range: [1, 8], step: 1, default: 4, desc: "Rotated sample taps — more = smoother layered flame" },
  tint: { type: COLOR, default: [255, 180, 80], desc: "Flame tint colour" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  variation: optionTypes.variation.default,
  amount: optionTypes.amount.default,
  zoom: optionTypes.zoom.default,
  rotate: optionTypes.rotate.default,
  taps: optionTypes.taps.default,
  tint: optionTypes.tint.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { flame: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    flame: linkProgram(gl, FLAME_FS, [
      "u_source", "u_res", "u_variation", "u_amount",
      "u_zoom", "u_rotate", "u_taps", "u_tint", "u_levels",
    ] as const),
  };
  return _cache;
};

const fractalFlame = (input: any, options = defaults) => {
  const { variation, amount, zoom, rotate, taps, tint, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "fractalFlame:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.flame, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.flame.uniforms.u_source, 0);
        gl.uniform2f(cache.flame.uniforms.u_res, W, H);
        gl.uniform1i(cache.flame.uniforms.u_variation, VAR_ID[variation] ?? 2);
        gl.uniform1f(cache.flame.uniforms.u_amount, amount);
        gl.uniform1f(cache.flame.uniforms.u_zoom, zoom);
        gl.uniform1f(cache.flame.uniforms.u_rotate, rotate);
        gl.uniform1i(cache.flame.uniforms.u_taps, Math.max(1, Math.min(8, Math.round(taps))));
        gl.uniform3f(cache.flame.uniforms.u_tint, tint[0], tint[1], tint[2]);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.flame.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Fractal Flame", "WebGL2",
            `${variation} taps=${taps}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Fractal Flame", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Fractal Flame",
  func: fractalFlame,
  optionTypes,
  options: defaults,
  defaults,
  description: "Per-pixel fractal-flame-style IFS warp — swirl, spherical, horseshoe, heart and other classic variations with layered multi-tap accumulation for the signature flame aesthetic",
  noWASM: "Variations evaluated per-pixel with multiple rotated taps — GPU-friendly, CPU-unfriendly.",
});
