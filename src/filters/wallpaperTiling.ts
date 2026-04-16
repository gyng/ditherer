import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
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

// Wallpaper-group tiling. Five of the 17 crystallographic groups cover
// the recognisable look-and-feel space for image stylisation; the rest
// are mostly variants. Each "group" defines a fundamental domain + a set
// of symmetry operations; the shader reflects/rotates the sample point
// back into the domain and reads the source.

const GROUP = { P1: "P1", P2: "P2", PMM: "PMM", P4M: "P4M", P6M: "P6M" };

const WALLPAPER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_group;     // 0 P1, 1 P2, 2 PMM, 3 P4M, 4 P6M
uniform float u_cellSize;  // Fundamental-domain size (px)
uniform vec2  u_centre;    // Tiling centre (px)
uniform float u_angle;     // Overall rotation
uniform float u_levels;

// Fold coordinate into a repeating cell of the given size.
float foldRepeat(float v, float size) {
  return mod(v, size);
}
// Fold with reflection: sawtooth-triangle pattern.
float foldReflect(float v, float size) {
  float m = mod(v, 2.0 * size);
  return m < size ? m : 2.0 * size - m;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Rotate into the tiling frame.
  float ca = cos(u_angle);
  float sa = sin(u_angle);
  vec2 p = vec2(x - u_centre.x, y - u_centre.y);
  p = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

  float sz = max(u_cellSize, 4.0);
  vec2 folded;

  if (u_group == 0) {
    // P1 — plain translation.
    folded = vec2(foldRepeat(p.x, sz), foldRepeat(p.y, sz));
  } else if (u_group == 1) {
    // P2 — 180° rotation centres at the unit-cell corners.
    float fx = mod(p.x, 2.0 * sz);
    float fy = mod(p.y, 2.0 * sz);
    if (fx >= sz) fx = 2.0 * sz - fx;
    if (fy >= sz) fy = 2.0 * sz - fy;
    folded = vec2(fx, fy);
  } else if (u_group == 2) {
    // PMM — mirrors in both axes.
    folded = vec2(foldReflect(p.x, sz), foldReflect(p.y, sz));
  } else if (u_group == 3) {
    // P4M — square + diagonal mirrors (the kaleidoscope you see in
    // tiling patterns with 4-fold symmetry).
    float fx = foldReflect(p.x, sz);
    float fy = foldReflect(p.y, sz);
    // Fold across the main diagonal for 8-fold symmetry within each cell.
    if (fy > fx) { float t = fx; fx = fy; fy = t; }
    folded = vec2(fx, fy);
  } else {
    // P6M — hexagonal with 6-fold + mirrors. Use axial hex coords.
    float s = sz;
    float hx = p.x;
    float hy = p.y;
    // Reduce into a hex cell (approximate via triangular fold).
    float q = hx / s;
    float r = (hy * 1.15470054 - hx * 0.57735027) / s;
    q = mod(q, 1.0);
    r = mod(r, 1.0);
    // Reflect if above the diagonal (equivalent to a mirror symmetry).
    if (q + r > 1.0) { q = 1.0 - q; r = 1.0 - r; }
    folded = vec2(q * s, r * s * 0.866);
  }

  // Sample from source using the folded coord as a UV into a single tile
  // of size sz × sz, scaled to the full source image so we see the whole
  // picture in each tile.
  vec2 scale = vec2(u_res.x / sz, u_res.y / sz);
  vec2 inSrc = folded * scale;
  inSrc = clamp(inSrc, vec2(0.0), u_res - vec2(1.0));
  vec4 c = texture(u_source, vec2((inSrc.x + 0.5) / u_res.x, 1.0 - (inSrc.y + 0.5) / u_res.y));
  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

export const optionTypes = {
  group: {
    type: ENUM,
    options: [
      { name: "P1 (translate)", value: GROUP.P1 },
      { name: "P2 (rotate 180°)", value: GROUP.P2 },
      { name: "PMM (mirror both axes)", value: GROUP.PMM },
      { name: "P4M (square kaleidoscope)", value: GROUP.P4M },
      { name: "P6M (hex kaleidoscope)", value: GROUP.P6M },
    ],
    default: GROUP.P4M,
    desc: "Wallpaper symmetry group"
  },
  cellSize: { type: RANGE, range: [10, 800], step: 1, default: 120, desc: "Fundamental-domain size (px)" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Tiling centre X (fraction of width)" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Tiling centre Y (fraction of height)" },
  angle: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Overall rotation (degrees)" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  group: optionTypes.group.default,
  cellSize: optionTypes.cellSize.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  angle: optionTypes.angle.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const GROUP_ID: Record<string, number> = { P1: 0, P2: 1, PMM: 2, P4M: 3, P6M: 4 };

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, WALLPAPER_FS, ["u_source", "u_res", "u_group", "u_cellSize", "u_centre", "u_angle", "u_levels"] as const) };
  return _cache;
};

const wallpaperTiling = (input: any, options = defaults) => {
  const { group, cellSize, centerX, centerY, angle, palette } = options;
  const W = input.width, H = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "wallpaper:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      drawPass(gl, null, W, H, cache.prog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.prog.uniforms.u_source, 0);
        gl.uniform2f(cache.prog.uniforms.u_res, W, H);
        gl.uniform1i(cache.prog.uniforms.u_group, GROUP_ID[group] ?? 3);
        gl.uniform1f(cache.prog.uniforms.u_cellSize, cellSize);
        gl.uniform2f(cache.prog.uniforms.u_centre, centerX * W, centerY * H);
        gl.uniform1f(cache.prog.uniforms.u_angle, (angle * Math.PI) / 180);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.prog.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);
      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Wallpaper Tiling", "WebGL2",
            `${group} cell=${cellSize}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Wallpaper Tiling", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Wallpaper Tiling",
  func: wallpaperTiling,
  optionTypes,
  options: defaults,
  defaults,
  description: "Crystallographic symmetry tiling (P1 / P2 / PMM / P4M / P6M) — reflects & rotates the image into a repeating wallpaper pattern",
  noWASM: "Pure per-pixel coordinate remap; GL natural fit.",
});
