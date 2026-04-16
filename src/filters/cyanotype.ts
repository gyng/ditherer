import { RANGE, COLOR, BOOL, PALETTE } from "constants/controlTypes";
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

// Cyanotype / blueprint print simulation. Tone-curves luminance onto the
// characteristic Prussian-blue → white gradient, with optional paper-
// texture grain, exposure contrast, and an edge-brightening "solarisation"
// roll-off at the highlights.

const CYANO_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec3  u_highlight;   // 0..255
uniform vec3  u_shadow;      // 0..255
uniform float u_exposure;
uniform float u_contrast;
uniform float u_grain;
uniform float u_paperTint;
uniform int   u_invert;
uniform float u_levels;

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;

  // Exposure + contrast around mid-grey.
  float t = clamp((lum - 0.5) * u_contrast + 0.5 + u_exposure, 0.0, 1.0);
  if (u_invert == 1) t = 1.0 - t;

  // Paper-texture grain — faint high-freq noise in the mid-tones.
  float grainMask = 1.0 - abs(t - 0.5) * 2.0;
  float noise = (hash1(vec2(x, y)) - 0.5) * u_grain * grainMask;
  t = clamp(t + noise, 0.0, 1.0);

  vec3 rgb = mix(u_shadow, u_highlight, t);
  // Paper tint at the highlights — warm off-white rather than pure white
  // matches real cyanotype paper stock.
  vec3 paperWarm = vec3(248.0, 243.0, 230.0);
  rgb = mix(rgb, paperWarm, u_paperTint * smoothstep(0.85, 1.0, t));

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  highlightColor: { type: COLOR, default: [236, 242, 250], desc: "Highlight colour (unexposed paper)" },
  shadowColor: { type: COLOR, default: [21, 43, 96], desc: "Shadow colour (Prussian-blue chemistry)" },
  exposure: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Exposure shift" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.4, desc: "Contrast around mid-grey" },
  grain: { type: RANGE, range: [0, 0.4], step: 0.005, default: 0.06, desc: "Paper-texture grain" },
  paperTint: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Warm paper tint in the highlights" },
  invert: { type: BOOL, default: false, desc: "Invert — negative print" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  highlightColor: optionTypes.highlightColor.default,
  shadowColor: optionTypes.shadowColor.default,
  exposure: optionTypes.exposure.default,
  contrast: optionTypes.contrast.default,
  grain: optionTypes.grain.default,
  paperTint: optionTypes.paperTint.default,
  invert: optionTypes.invert.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, CYANO_FS, [
    "u_source", "u_res", "u_highlight", "u_shadow",
    "u_exposure", "u_contrast", "u_grain", "u_paperTint", "u_invert", "u_levels",
  ] as const) };
  return _cache;
};

const cyanotype = (input: any, options = defaults) => {
  const { highlightColor, shadowColor, exposure, contrast, grain, paperTint, invert, palette } = options;
  const W = input.width, H = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "cyanotype:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      drawPass(gl, null, W, H, cache.prog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.prog.uniforms.u_source, 0);
        gl.uniform2f(cache.prog.uniforms.u_res, W, H);
        gl.uniform3f(cache.prog.uniforms.u_highlight, highlightColor[0], highlightColor[1], highlightColor[2]);
        gl.uniform3f(cache.prog.uniforms.u_shadow, shadowColor[0], shadowColor[1], shadowColor[2]);
        gl.uniform1f(cache.prog.uniforms.u_exposure, exposure);
        gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
        gl.uniform1f(cache.prog.uniforms.u_grain, grain * 255);
        gl.uniform1f(cache.prog.uniforms.u_paperTint, paperTint);
        gl.uniform1i(cache.prog.uniforms.u_invert, invert ? 1 : 0);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.prog.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);
      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Cyanotype", "WebGL2",
            `contrast=${contrast} grain=${grain}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Cyanotype", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Cyanotype",
  func: cyanotype,
  optionTypes,
  options: defaults,
  defaults,
  description: "Cyanotype / blueprint print — Prussian-blue two-tone mapping with exposure, contrast, paper grain, and warm-paper highlights",
  noWASM: "Pure per-pixel tone map + hash noise; GL natural fit.",
});
