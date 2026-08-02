import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { normalizeRangeOption } from "../utils/filterOptions";
import { ANAMORPH_GLSL } from "./anamorphMapping";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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
} from "../gl/index";

// Cylindrical-mirror anamorphosis. A reflective cylinder of radius R_c stands at
// the centre; the anamorphic drawing occupies the annulus around it. By the law
// of reflection a point at height z on the cylinder maps to plane radius
// r = R_c + z·cot(α), so the radial map is LINEAR in image height (angle is
// preserved, the mirror being rotationally symmetric) — not the arbitrary log
// remap the old version used. The inner disc renders the undistorted image as a
// polar mirror preview (what you would see reflected), joined continuously to
// the annulus at the wall. The mapping mirrors the unit-tested anamorphMapping.ts.

const ANAMORPH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_cylR;        // Mirror radius (px)
uniform float u_maxR;        // Outer radius of the anamorphic annulus
uniform float u_twist;       // Angular twist around the cylinder (radians)
uniform float u_levels;
${ANAMORPH_GLSL}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  float dx = x - cx;
  float dy = y - cy;
  float r = length(vec2(dx, dy));
  float theta = atan(dy, dx);
  float u = am_angleU(theta, u_twist);

  float v;
  if (r < u_cylR) {
    v = am_discHeight(r, u_cylR);            // inner mirror-preview disc
  } else if (r <= u_maxR) {
    v = am_annulusHeight(r, u_cylR, u_maxR); // linear reflection map
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);    // beyond the drawing
    return;
  }

  float sx = clamp(u * u_res.x, 0.0, u_res.x - 1.0);
  float sy = clamp(v * u_res.y, 0.0, u_res.y - 1.0);
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
  cylinderRadius: {
    type: RANGE,
    range: [10, 400],
    step: 1,
    default: 80,
    desc: "Mirror radius (px) — below this is the 'reflection' view",
  },
  maxRadius: {
    type: RANGE,
    range: [50, 2048],
    step: 1,
    default: 500,
    desc: "Outer radius of the distorted annulus",
  },
  twist: {
    type: RANGE,
    range: [0, 360],
    step: 1,
    default: 0,
    desc: "Angular twist around the cylinder (degrees)",
  },
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
  _cache = {
    prog: linkProgram(gl, ANAMORPH_FS, [
      "u_source",
      "u_res",
      "u_cylR",
      "u_maxR",
      "u_twist",
      "u_levels",
    ] as const),
  };
  return _cache;
};

const anamorphicCylinder = (input: any, options: Partial<typeof defaults> = defaults) => {
  const cylinderRadius = normalizeRangeOption(
    options.cylinderRadius,
    defaults.cylinderRadius,
    10,
    400,
    true,
  );
  const maxRadius = normalizeRangeOption(options.maxRadius, defaults.maxRadius, 50, 2048, true);
  const twist = normalizeRangeOption(options.twist, defaults.twist, 0, 360);
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;
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
      drawPass(
        gl,
        null,
        W,
        H,
        cache.prog,
        () => {
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
        },
        vao,
      );
      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend(
            "Anamorphic Cylinder",
            "WebGL2",
            `cyl=${cylinderRadius} max=${maxRadius}${identity ? "" : "+palettePass"}`,
          );
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
  description:
    "Cylindrical anamorphosis — classic 'stretched disc' distortion that unwarps when viewed in a reflective cylinder placed at the centre",
  noWASM: "Pure per-pixel warp; GL natural fit.",
});
