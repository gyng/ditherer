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

// Signed-distance-field stylisation. Treat a luminance iso-threshold as a
// binary mask, approximate the distance to that mask via jump-flood, then
// render isolines / offset strokes / bevelled fills. The jump-flood part
// is iterative but runs entirely on the GPU — 8 ping-pong passes at
// log₂(max_dim) strides are enough for 1280×720.

const MODE = { ISOLINES: "ISOLINES", OFFSET: "OFFSET", BEVEL: "BEVEL" };

// --- Pass 1: seed luminance → above/below threshold. Seeds a JFA-style
// distance field by storing the pixel's own coords in the R/G channels
// when it's "on", (-1, -1) when "off". UV-normalised coords in [0, 1].
const SEED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec3 c = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum >= u_threshold) {
    fragColor = vec4(x / u_res.x, y / u_res.y, 0.0, 1.0);
  } else {
    fragColor = vec4(-1.0, -1.0, 0.0, 1.0);
  }
}
`;

// --- Jump flood step. For each pixel, examine the 8 neighbours at
// stride `u_step`; keep whichever neighbour's seed is closest.
const JFA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform float u_step;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  vec2 me = vec2(x, y) / u_res;
  vec4 best = texelFetch(u_input, ivec2(x, y), 0);
  float bestD = best.x < 0.0 ? 1e9 : distance(me, best.rg);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      ivec2 nc = ivec2(x + float(i) * u_step, y + float(j) * u_step);
      if (nc.x < 0 || nc.y < 0 || nc.x >= int(u_res.x) || nc.y >= int(u_res.y)) continue;
      vec4 n = texelFetch(u_input, nc, 0);
      if (n.x < 0.0) continue;
      float d = distance(me, n.rg);
      if (d < bestD) { bestD = d; best = n; }
    }
  }
  fragColor = best;
}
`;

// --- Render pass. Convert JFA seed info → distance → isoline / offset /
// bevel stylisation.
const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_jfa;
uniform vec2  u_res;
uniform int   u_mode;       // 0 ISOLINES, 1 OFFSET, 2 BEVEL
uniform float u_spacing;    // isoline spacing (px)
uniform float u_thickness;  // line thickness (px)
uniform vec3  u_lineColor;
uniform vec3  u_fillColor;
uniform float u_threshold;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 me = vec2(x, y) / u_res;
  vec4 seed = texelFetch(u_jfa, ivec2(x, floor(px.y)), 0);
  float d = seed.x < 0.0 ? 1e9 : distance(me, seed.rg) * max(u_res.x, u_res.y);

  vec3 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  bool inside = lum >= u_threshold;
  // Signed: positive = inside, negative = outside (the thing we seeded
  // was "above threshold"; JFA returns the distance to the nearest on-pixel,
  // so d is always ≥ 0. For outside pixels, the sign flips to negative.)
  float sd = inside ? -d : d;

  vec3 rgb;
  if (u_mode == 0) {
    // Isolines: stripes at multiples of u_spacing.
    float loop = mod(abs(sd), u_spacing);
    float lineDist = min(loop, u_spacing - loop);
    float lineMask = 1.0 - smoothstep(u_thickness * 0.5 - 0.5, u_thickness * 0.5 + 0.5, lineDist);
    rgb = mix(u_fillColor, u_lineColor, lineMask);
  } else if (u_mode == 1) {
    // Offset / bands: each u_spacing band alternates inside/outside contour.
    float band = floor(sd / u_spacing);
    float t = clamp(band / 8.0 + 0.5, 0.0, 1.0);
    rgb = mix(u_fillColor, u_lineColor, t);
  } else {
    // Bevel — brighten inside, darken outside, linear falloff.
    float t = clamp(-sd / u_spacing * 0.5 + 0.5, 0.0, 1.0);
    rgb = mix(u_lineColor, u_fillColor, t);
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { seed: Program; jfa: Program; render: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    seed: linkProgram(gl, SEED_FS, ["u_source", "u_res", "u_threshold"] as const),
    jfa: linkProgram(gl, JFA_FS, ["u_input", "u_res", "u_step"] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_source", "u_jfa", "u_res", "u_mode",
      "u_spacing", "u_thickness", "u_lineColor", "u_fillColor",
      "u_threshold", "u_levels",
    ] as const),
  };
  return _cache;
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Isolines", value: MODE.ISOLINES },
      { name: "Offset bands", value: MODE.OFFSET },
      { name: "Bevel", value: MODE.BEVEL },
    ],
    default: MODE.ISOLINES,
    desc: "SDF rendering style"
  },
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Luminance threshold for the binary mask" },
  spacing: { type: RANGE, range: [2, 80], step: 1, default: 16, desc: "Isoline / band spacing (px)" },
  thickness: { type: RANGE, range: [0.5, 10], step: 0.5, default: 1.5, desc: "Line thickness (isolines only)" },
  lineColor: { type: COLOR, default: [20, 20, 20], desc: "Line / shadow colour" },
  fillColor: { type: COLOR, default: [240, 235, 220], desc: "Fill / highlight colour" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  mode: optionTypes.mode.default,
  threshold: optionTypes.threshold.default,
  spacing: optionTypes.spacing.default,
  thickness: optionTypes.thickness.default,
  lineColor: optionTypes.lineColor.default,
  fillColor: optionTypes.fillColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const MODE_ID: Record<string, number> = { ISOLINES: 0, OFFSET: 1, BEVEL: 2 };

const sdfStylize = (input: any, options = defaults) => {
  const { mode, threshold, spacing, thickness, lineColor, fillColor, palette } = options;
  const W = input.width, H = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "sdfStylize:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      // Note: JFA needs the seed coords in sub-pixel precision; we store
      // them in RGBA8 as UV-normalised fractions so we don't need float
      // attachments. 255-level quantisation gives ~4-pixel precision at
      // 1280×720 — more than fine for stylised isolines/offsets.
      const jfaA = ensureTexture(gl, "sdfStylize:jfaA", W, H);
      const jfaB = ensureTexture(gl, "sdfStylize:jfaB", W, H);

      drawPass(gl, jfaA, W, H, cache.seed, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.seed.uniforms.u_source, 0);
        gl.uniform2f(cache.seed.uniforms.u_res, W, H);
        gl.uniform1f(cache.seed.uniforms.u_threshold, threshold);
      }, vao);

      let src = jfaA; let dst = jfaB;
      const maxDim = Math.max(W, H);
      let step = 1;
      while (step * 2 < maxDim) step *= 2;
      for (; step >= 1; step = Math.floor(step / 2)) {
        drawPass(gl, dst, W, H, cache.jfa, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform1i(cache.jfa.uniforms.u_input, 0);
          gl.uniform2f(cache.jfa.uniforms.u_res, W, H);
          gl.uniform1f(cache.jfa.uniforms.u_step, step);
        }, vao);
        [src, dst] = [dst, src];
      }

      drawPass(gl, null, W, H, cache.render, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.render.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(cache.render.uniforms.u_jfa, 1);
        gl.uniform2f(cache.render.uniforms.u_res, W, H);
        gl.uniform1i(cache.render.uniforms.u_mode, MODE_ID[mode] ?? 0);
        gl.uniform1f(cache.render.uniforms.u_spacing, spacing);
        gl.uniform1f(cache.render.uniforms.u_thickness, thickness);
        gl.uniform3f(cache.render.uniforms.u_lineColor, lineColor[0], lineColor[1], lineColor[2]);
        gl.uniform3f(cache.render.uniforms.u_fillColor, fillColor[0], fillColor[1], fillColor[2]);
        gl.uniform1f(cache.render.uniforms.u_threshold, threshold);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.render.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("SDF Stylize", "WebGL2",
            `${mode} spacing=${spacing}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("SDF Stylize", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "SDF Stylize",
  func: sdfStylize,
  optionTypes,
  options: defaults,
  defaults,
  description: "Distance-field stylisation via jump-flood: render luminance iso-thresholds as isolines, offset bands, or bevelled fills",
  noWASM: "Jump-flood distance field is O(N log N) on GPU vs O(N²) on CPU.",
});
