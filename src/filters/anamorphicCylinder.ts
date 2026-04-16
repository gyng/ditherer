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

// Cylindrical anamorphosis: remaps the image so that, viewed in a
// reflective cylinder placed at the centre, the original becomes visible
// on the cylinder's surface. Around the cylinder (outside the mirror) the
// image appears stretched and warped — the classic "anamorphic distortion"
// print look. The forward map sends source pixel (r, θ) to
// (r_mirror + R·ln(r / r_mirror), θ) in polar coords. Inverse (what we
// need for gather sampling) undoes that log.

const ANAMORPH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_cylR;        // Mirror radius (px)
uniform float u_maxR;        // Max mapped radius
uniform float u_twist;       // Extra angular twist around the cylinder
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  float dx = x - cx;
  float dy = y - cy;
  float r = sqrt(dx * dx + dy * dy);
  float theta = atan(dy, dx);

  // If inside the mirror region, show the original image wrapped around
  // the cylinder surface (unwarped view). Outside, apply the log-radius
  // expansion that turns a ring into a stretched strip.
  if (r < u_cylR) {
    // Inside: render the mirror's reflection — the unwarped image at the
    // same (normalised) polar coords.
    vec2 sp = vec2(cx + dx, cy + dy);
    sp = clamp(sp, vec2(0.0), u_res - vec2(1.0));
    vec4 c = texture(u_source, vec2((sp.x + 0.5) / u_res.x, 1.0 - (sp.y + 0.5) / u_res.y));
    vec3 rgb = c.rgb;
    if (u_levels > 1.5) {
      float q = u_levels - 1.0;
      rgb = floor(rgb * q + 0.5) / q;
    }
    fragColor = vec4(rgb, c.a);
    return;
  }

  // Outside: invert the log-radius stretching. r (output) = r_mirror + R·ln(r_src/r_mirror)
  // so r_src = r_mirror * exp((r - r_mirror)/R).
  float span = u_maxR - u_cylR;
  float tR = (r - u_cylR) / max(span, 1e-3);
  float rSrc = u_cylR * exp(tR * log(u_maxR / u_cylR));
  float theta2 = theta + u_twist;

  float sx = cx + rSrc * cos(theta2);
  float sy = cy + rSrc * sin(theta2);
  if (sx < 0.0 || sx >= u_res.x || sy < 0.0 || sy >= u_res.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
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
  cylinderRadius: { type: RANGE, range: [10, 400], step: 1, default: 80, desc: "Mirror radius (px) — below this is the 'reflection' view" },
  maxRadius: { type: RANGE, range: [50, 2048], step: 1, default: 500, desc: "Outer radius of the distorted annulus" },
  twist: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Angular twist around the cylinder (degrees)" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  cylinderRadius: optionTypes.cylinderRadius.default,
  maxRadius: optionTypes.maxRadius.default,
  twist: optionTypes.twist.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, ANAMORPH_FS, ["u_source", "u_res", "u_cylR", "u_maxR", "u_twist", "u_levels"] as const) };
  return _cache;
};

const anamorphicCylinder = (input: any, options = defaults) => {
  const { cylinderRadius, maxRadius, twist, palette } = options;
  const W = input.width, H = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "anamorph:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      drawPass(gl, null, W, H, cache.prog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.prog.uniforms.u_source, 0);
        gl.uniform2f(cache.prog.uniforms.u_res, W, H);
        gl.uniform1f(cache.prog.uniforms.u_cylR, cylinderRadius);
        gl.uniform1f(cache.prog.uniforms.u_maxR, Math.max(maxRadius, cylinderRadius + 10));
        gl.uniform1f(cache.prog.uniforms.u_twist, (twist * Math.PI) / 180);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.prog.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);
      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Anamorphic Cylinder", "WebGL2",
            `cyl=${cylinderRadius} max=${maxRadius}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Anamorphic Cylinder", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Anamorphic Cylinder",
  func: anamorphicCylinder,
  optionTypes,
  options: defaults,
  defaults,
  description: "Cylindrical anamorphosis — classic 'stretched disc' distortion that unwarps when viewed in a reflective cylinder placed at the centre",
  noWASM: "Pure per-pixel warp; GL natural fit.",
});
