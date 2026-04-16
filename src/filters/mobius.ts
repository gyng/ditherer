import { RANGE, PALETTE } from "constants/controlTypes";
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

// Möbius transformation on the unit disc: z → (az + b) / (cz + d) with
// complex parameters. Maps circles to circles (and lines). Produces
// psychedelic swirls and conformal stretches — a classic "magic mirror".

const MOBIUS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_a, u_b, u_c, u_d;
uniform float u_levels;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) {
  float dn = dot(b, b);
  return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / max(dn, 1e-8);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Map to complex z ∈ [-1, 1] on shortest axis.
  float scale = min(u_res.x, u_res.y) * 0.5;
  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  vec2 z = vec2((x - cx) / scale, (y - cy) / scale);

  vec2 num = cmul(u_a, z) + u_b;
  vec2 den = cmul(u_c, z) + u_d;
  vec2 w = cdiv(num, den);

  // Map back to image pixels.
  vec2 sp = vec2(w.x * scale + cx, w.y * scale + cy);
  sp = clamp(sp, vec2(0.0), u_res - vec2(1.0));

  vec4 c = texture(u_source, vec2((sp.x + 0.5) / u_res.x, 1.0 - (sp.y + 0.5) / u_res.y));
  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

export const optionTypes = {
  aRe: { type: RANGE, range: [-2, 2], step: 0.01, default: 1, desc: "Parameter a (real part)" },
  aIm: { type: RANGE, range: [-2, 2], step: 0.01, default: 0, desc: "Parameter a (imaginary part)" },
  bRe: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.3, desc: "Parameter b (real part)" },
  bIm: { type: RANGE, range: [-2, 2], step: 0.01, default: 0, desc: "Parameter b (imaginary part)" },
  cRe: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.3, desc: "Parameter c (real part)" },
  cIm: { type: RANGE, range: [-2, 2], step: 0.01, default: 0, desc: "Parameter c (imaginary part)" },
  dRe: { type: RANGE, range: [-2, 2], step: 0.01, default: 1, desc: "Parameter d (real part)" },
  dIm: { type: RANGE, range: [-2, 2], step: 0.01, default: 0, desc: "Parameter d (imaginary part)" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  aRe: optionTypes.aRe.default, aIm: optionTypes.aIm.default,
  bRe: optionTypes.bRe.default, bIm: optionTypes.bIm.default,
  cRe: optionTypes.cRe.default, cIm: optionTypes.cIm.default,
  dRe: optionTypes.dRe.default, dIm: optionTypes.dIm.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, MOBIUS_FS, ["u_source", "u_res", "u_a", "u_b", "u_c", "u_d", "u_levels"] as const) };
  return _cache;
};

const mobius = (input: any, options = defaults) => {
  const { aRe, aIm, bRe, bIm, cRe, cIm, dRe, dIm, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "mobius:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      drawPass(gl, null, W, H, cache.prog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.prog.uniforms.u_source, 0);
        gl.uniform2f(cache.prog.uniforms.u_res, W, H);
        gl.uniform2f(cache.prog.uniforms.u_a, aRe, aIm);
        gl.uniform2f(cache.prog.uniforms.u_b, bRe, bIm);
        gl.uniform2f(cache.prog.uniforms.u_c, cRe, cIm);
        gl.uniform2f(cache.prog.uniforms.u_d, dRe, dIm);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.prog.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);
      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Möbius", "WebGL2",
            `a=(${aRe},${aIm}) b=(${bRe},${bIm}) c=(${cRe},${cIm}) d=(${dRe},${dIm})${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Möbius", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Möbius",
  func: mobius,
  optionTypes,
  options: defaults,
  defaults,
  description: "Möbius transformation z → (az+b)/(cz+d) on the unit disc — conformal swirls and loops",
  noWASM: "Pure per-pixel coordinate transform; GL is the natural fit.",
});
