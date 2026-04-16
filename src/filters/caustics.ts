import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
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

// Luminance-driven caustics: treat the image as a height field, compute its
// gradient, and refract a vertical light ray through that surface. Focusing
// regions (where rays converge) become bright caustic highlights; defocusing
// regions get shadowed. A second octave of finer distortion adds the
// characteristic shimmering web.

const CAUSTIC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_ior;        // "index of refraction" — how much gradients bend rays
uniform float u_scale;      // distortion distance (px)
uniform float u_intensity;  // caustic highlight strength
uniform float u_shadow;     // shadow (defocus) strength
uniform vec3  u_tint;       // caustic highlight colour
uniform float u_levels;
uniform float u_time;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec2 grad(vec2 uv, vec2 px) {
  float l = lum(texture(u_source, uv - vec2(px.x, 0.0)).rgb);
  float r = lum(texture(u_source, uv + vec2(px.x, 0.0)).rgb);
  float d = lum(texture(u_source, uv - vec2(0.0, px.y)).rgb);
  float t = lum(texture(u_source, uv + vec2(0.0, px.y)).rgb);
  return vec2(r - l, t - d);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec2 onePx = 1.0 / u_res;

  // Refract along the two-octave gradient field. Second octave samples at
  // a coarser step to pick up larger-scale convergence.
  vec2 g1 = grad(suv, onePx);
  vec2 g2 = grad(suv, onePx * 4.0);
  vec2 warp = -(g1 + g2 * 0.6) * u_ior * u_scale;
  vec2 refracted = suv + warp * onePx;

  // Jacobian-of-warp magnitude → caustic brightness. High |dWarp/dpos|
  // means rays are converging/diverging fast → bright or dark focusing.
  vec2 gx = grad(suv + vec2(onePx.x, 0.0), onePx) - grad(suv - vec2(onePx.x, 0.0), onePx);
  vec2 gy = grad(suv + vec2(0.0, onePx.y), onePx) - grad(suv - vec2(0.0, onePx.y), onePx);
  float div = (gx.x + gy.y) * u_ior;

  vec3 base = texture(u_source, refracted).rgb;
  float focus = clamp(-div * 80.0, -1.0, 1.0);
  // Shimmer: a tiny time-driven offset in highlight colour
  float shimmer = 0.5 + 0.5 * sin(u_time + (suv.x + suv.y) * 20.0);

  vec3 rgb;
  if (focus > 0.0) {
    vec3 hl = mix(u_tint / 255.0, vec3(1.0), 0.4 + shimmer * 0.2);
    rgb = base + hl * focus * u_intensity;
  } else {
    rgb = base * mix(1.0, 0.25, -focus * u_shadow);
  }
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  scale: { type: RANGE, range: [1, 60], step: 1, default: 16, desc: "Refraction distance (px)" },
  ior: { type: RANGE, range: [0, 4], step: 0.05, default: 1.2, desc: "How strongly the surface bends light" },
  intensity: { type: RANGE, range: [0, 4], step: 0.05, default: 1.6, desc: "Caustic highlight strength" },
  shadow: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Defocus shadow strength" },
  tint: { type: COLOR, default: [255, 250, 200], desc: "Caustic highlight colour" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  scale: optionTypes.scale.default,
  ior: optionTypes.ior.default,
  intensity: optionTypes.intensity.default,
  shadow: optionTypes.shadow.default,
  tint: optionTypes.tint.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { caustic: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    caustic: linkProgram(gl, CAUSTIC_FS, [
      "u_source", "u_res", "u_ior", "u_scale", "u_intensity",
      "u_shadow", "u_tint", "u_levels", "u_time",
    ] as const),
  };
  return _cache;
};

const caustics = (input: any, options = defaults) => {
  const { scale, ior, intensity, shadow, tint, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "caustics:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.caustic, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.caustic.uniforms.u_source, 0);
        gl.uniform2f(cache.caustic.uniforms.u_res, W, H);
        gl.uniform1f(cache.caustic.uniforms.u_ior, ior);
        gl.uniform1f(cache.caustic.uniforms.u_scale, scale);
        gl.uniform1f(cache.caustic.uniforms.u_intensity, intensity);
        gl.uniform1f(cache.caustic.uniforms.u_shadow, shadow);
        gl.uniform3f(cache.caustic.uniforms.u_tint, tint[0], tint[1], tint[2]);
        gl.uniform1f(cache.caustic.uniforms.u_time, (performance.now() / 1000) % 1000);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.caustic.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Caustics", "WebGL2",
            `ior=${ior} scale=${scale}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Caustics", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Caustics",
  func: caustics,
  optionTypes,
  options: defaults,
  defaults,
  description: "Refract light through the image as if it were a glass surface — bright caustic webs where gradients converge, shadows where they diverge",
  noWASM: "Gradient-driven refraction on the GPU has no CPU equivalent that'd be fast enough to be interactive.",
});
