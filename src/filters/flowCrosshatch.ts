import { RANGE, BOOL, COLOR, PALETTE } from "constants/controlTypes";
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

// Crosshatching that follows the image's edge flow rather than a fixed
// angle — gives ink strokes the right anatomical direction (a cheek's
// shading curves around the cheekbone, hair flows along its strands, etc.).
// Two hatch layers at perpendicular orientations, stacked by darkness.

const HATCH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_spacing;
uniform float u_thickness;
uniform vec3  u_inkColor;
uniform vec3  u_paperColor;
uniform float u_t1;       // luminance threshold for 1st hatch layer
uniform float u_t2;       // threshold for the perpendicular 2nd layer
uniform int   u_preserveColor;
uniform float u_levels;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec2 tangent(vec2 uv, vec2 px) {
  float l = lum(texture(u_source, uv - vec2(px.x, 0.0)).rgb);
  float r = lum(texture(u_source, uv + vec2(px.x, 0.0)).rgb);
  float d = lum(texture(u_source, uv - vec2(0.0, px.y)).rgb);
  float t = lum(texture(u_source, uv + vec2(0.0, px.y)).rgb);
  vec2 g = vec2(r - l, t - d);
  if (length(g) < 1e-4) return vec2(1.0, 0.0);
  return normalize(vec2(-g.y, g.x));
}

float hatchMask(vec2 pxPos, vec2 dir, float spacing, float thickness) {
  // Project position onto the direction perpendicular to the hatch lines,
  // then mod by spacing to find the distance-to-nearest-line.
  vec2 perp = vec2(-dir.y, dir.x);
  float proj = dot(pxPos, perp);
  float m = mod(proj, spacing);
  float dist = min(m, spacing - m);
  return 1.0 - smoothstep(thickness * 0.5 - 0.5, thickness * 0.5 + 0.5, dist);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec2 onePx = 1.0 / u_res;
  vec3 src = texture(u_source, suv).rgb;
  float L = lum(src);
  vec2 dir = tangent(suv, onePx);
  vec2 perp = vec2(-dir.y, dir.x);

  vec2 pxPos = vec2(x, y);
  float h1 = hatchMask(pxPos, dir, u_spacing, u_thickness);
  float h2 = hatchMask(pxPos, perp, u_spacing, u_thickness);

  // Darker areas get both hatch layers; mid tones only one; bright tones none.
  float layer1 = 1.0 - smoothstep(u_t1 - 0.05, u_t1 + 0.05, L);
  float layer2 = 1.0 - smoothstep(u_t2 - 0.05, u_t2 + 0.05, L);
  float ink = max(h1 * layer1, h2 * layer2);

  vec3 paper = u_preserveColor == 1 ? src : u_paperColor / 255.0;
  vec3 inkC = u_inkColor / 255.0;
  vec3 rgb = mix(paper, inkC, ink);
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  spacing: { type: RANGE, range: [2, 30], step: 0.5, default: 6, desc: "Hatch line spacing (px)" },
  thickness: { type: RANGE, range: [0.5, 5], step: 0.1, default: 1.2, desc: "Hatch line thickness (px)" },
  t1: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Luminance threshold for primary hatch" },
  t2: { type: RANGE, range: [0, 1], step: 0.01, default: 0.35, desc: "Luminance threshold for cross-hatch (shadow layer)" },
  inkColor: { type: COLOR, default: [20, 22, 28], desc: "Ink colour" },
  paperColor: { type: COLOR, default: [245, 240, 228], desc: "Paper colour (when not preserving source)" },
  preserveColor: { type: BOOL, default: false, desc: "Keep source colour as the paper (ink strokes over photo) instead of flat paper" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  spacing: optionTypes.spacing.default,
  thickness: optionTypes.thickness.default,
  t1: optionTypes.t1.default,
  t2: optionTypes.t2.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  preserveColor: optionTypes.preserveColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { hatch: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    hatch: linkProgram(gl, HATCH_FS, [
      "u_source", "u_res", "u_spacing", "u_thickness",
      "u_inkColor", "u_paperColor", "u_t1", "u_t2",
      "u_preserveColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const flowCrosshatch = (input: any, options = defaults) => {
  const { spacing, thickness, t1, t2, inkColor, paperColor, preserveColor, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "flowCrosshatch:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.hatch, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.hatch.uniforms.u_source, 0);
        gl.uniform2f(cache.hatch.uniforms.u_res, W, H);
        gl.uniform1f(cache.hatch.uniforms.u_spacing, spacing);
        gl.uniform1f(cache.hatch.uniforms.u_thickness, thickness);
        gl.uniform3f(cache.hatch.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
        gl.uniform3f(cache.hatch.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
        gl.uniform1f(cache.hatch.uniforms.u_t1, t1);
        gl.uniform1f(cache.hatch.uniforms.u_t2, t2);
        gl.uniform1i(cache.hatch.uniforms.u_preserveColor, preserveColor ? 1 : 0);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.hatch.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Flow Crosshatch", "WebGL2",
            `spacing=${spacing}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Flow Crosshatch", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Flow Crosshatch",
  func: flowCrosshatch,
  optionTypes,
  options: defaults,
  defaults,
  description: "Crosshatch ink strokes that follow the image's edge flow — hair curves along its strands, cheeks around the cheekbone, instead of a fixed global angle",
  noWASM: "Tangent-field hatching at 1280×720 needs the GPU.",
});
