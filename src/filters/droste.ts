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

// Droste recursion: log-polar remap with a twist, so the image spirals
// into itself Escher-style. The number of self-repeats per full turn is
// set by `twist`, and `rInner/rOuter` bound the recursion radius so we
// don't sample a single pixel forever.

const DROSTE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_twist;     // turns per log-radius step
uniform float u_rInner;
uniform float u_rOuter;
uniform float u_angle;     // overall rotation (radians)
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  float dx = x - cx;
  float dy = y - cy;
  float r = max(1e-3, sqrt(dx * dx + dy * dy));
  float theta = atan(dy, dx);

  // Log-polar → apply twist → back to polar. The twist shears along the
  // log-radius axis, which is what makes the recursion visually "spiral".
  float logR = log(r);
  // Shift theta by u_twist * logR so the spiral self-matches.
  float theta2 = theta + u_twist * logR + u_angle;
  // Wrap the log-radius into [log(rInner), log(rOuter)] so the spiral
  // loops back into the visible image at each period.
  float logMin = log(u_rInner);
  float logMax = log(u_rOuter);
  float span = logMax - logMin;
  float logR2 = logMin + mod(logR - logMin, span);
  float r2 = exp(logR2);

  float sx = cx + r2 * cos(theta2);
  float sy = cy + r2 * sin(theta2);
  sx = clamp(sx, 0.0, u_res.x - 1.0);
  sy = clamp(sy, 0.0, u_res.y - 1.0);
  vec4 c = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y));

  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

export const optionTypes = {
  twist: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.3, desc: "Twist per log-radius step (controls the spiral tightness)" },
  rInner: { type: RANGE, range: [1, 200], step: 1, default: 40, desc: "Inner radius (px)" },
  rOuter: { type: RANGE, range: [10, 2048], step: 1, default: 400, desc: "Outer radius (px)" },
  angle: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Overall rotation (degrees)" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  twist: optionTypes.twist.default,
  rInner: optionTypes.rInner.default,
  rOuter: optionTypes.rOuter.default,
  angle: optionTypes.angle.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, DROSTE_FS, ["u_source", "u_res", "u_twist", "u_rInner", "u_rOuter", "u_angle", "u_levels"] as const) };
  return _cache;
};

const droste = (input: any, options = defaults) => {
  const { twist, rInner, rOuter, angle, palette } = options;
  const W = input.width, H = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "droste:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      drawPass(gl, null, W, H, cache.prog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.prog.uniforms.u_source, 0);
        gl.uniform2f(cache.prog.uniforms.u_res, W, H);
        gl.uniform1f(cache.prog.uniforms.u_twist, twist);
        gl.uniform1f(cache.prog.uniforms.u_rInner, rInner);
        gl.uniform1f(cache.prog.uniforms.u_rOuter, rOuter);
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
          logFilterBackend("Droste", "WebGL2",
            `twist=${twist} r=[${rInner},${rOuter}]${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Droste", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Droste",
  func: droste,
  optionTypes,
  options: defaults,
  defaults,
  description: "Log-polar spiral recursion — pulls the image into itself Escher-style. Twist controls the spiral, rInner/rOuter bound the recursion radius",
  noWASM: "Pure per-pixel warp; GL natural fit.",
});
