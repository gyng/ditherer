import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

export const optionTypes = {
  blackPoint: { type: RANGE, range: [0, 255], step: 1, default: 0, desc: "Input shadow clipping point" },
  whitePoint: { type: RANGE, range: [0, 255], step: 1, default: 255, desc: "Input highlight clipping point" },
  gamma: { type: RANGE, range: [0.1, 3], step: 0.05, default: 1, desc: "Midtone gamma curve (>1 brightens, <1 darkens)" },
  outputBlack: { type: RANGE, range: [0, 255], step: 1, default: 0, desc: "Minimum output value (lifts shadows)" },
  outputWhite: { type: RANGE, range: [0, 255], step: 1, default: 255, desc: "Maximum output value (clamps highlights)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  blackPoint: optionTypes.blackPoint.default,
  whitePoint: optionTypes.whitePoint.default,
  gamma: optionTypes.gamma.default,
  outputBlack: optionTypes.outputBlack.default,
  outputWhite: optionTypes.outputWhite.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type LevelsOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
};

const LEVELS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_inBlack;   // normalised [0,1]
uniform float u_inWhite;
uniform float u_outBlack;
uniform float u_outWhite;
uniform float u_invGamma;
uniform int   u_linearize; // 1 = apply sRGB→linear→remap→linear→sRGB
uniform float u_levels;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 applyLevels(vec3 c) {
  vec3 t = clamp((c - u_inBlack) / max(1e-6, u_inWhite - u_inBlack), 0.0, 1.0);
  t = pow(t, vec3(u_invGamma));
  return clamp(u_outBlack + t * (u_outWhite - u_outBlack), 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec3 c = texture(u_source, suv).rgb;

  vec3 rgb;
  if (u_linearize == 1) {
    vec3 lin = srgbToLinear(c);
    vec3 remapped = applyLevels(lin);
    rgb = linearToSrgb(remapped);
  } else {
    rgb = applyLevels(c);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type GLCache = { levels: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    levels: linkProgram(gl, LEVELS_FS, [
      "u_source", "u_res", "u_inBlack", "u_inWhite", "u_outBlack",
      "u_outWhite", "u_invGamma", "u_linearize", "u_levels",
    ] as const),
  };
  return _glCache;
};

const levelsFilter = (input: any, options: LevelsOptions = defaults) => {
  const { blackPoint, whitePoint, gamma, outputBlack, outputWhite, palette } = options;
  const linearize = options._linearize === true;
  const W = input.width;
  const H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return input;
  const { gl, canvas } = ctx;
  const cache = initGLCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "levels:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const identity = paletteIsIdentity(palette);
  drawPass(gl, null, W, H, cache.levels, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.levels.uniforms.u_source, 0);
    gl.uniform2f(cache.levels.uniforms.u_res, W, H);
    gl.uniform1f(cache.levels.uniforms.u_inBlack, blackPoint / 255);
    gl.uniform1f(cache.levels.uniforms.u_inWhite, whitePoint / 255);
    gl.uniform1f(cache.levels.uniforms.u_outBlack, outputBlack / 255);
    gl.uniform1f(cache.levels.uniforms.u_outWhite, outputWhite / 255);
    gl.uniform1f(cache.levels.uniforms.u_invGamma, 1 / Math.max(1e-4, gamma));
    gl.uniform1i(cache.levels.uniforms.u_linearize, linearize ? 1 : 0);
    const pOpts = (palette as { options?: { levels?: number } }).options;
    gl.uniform1f(cache.levels.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Levels", "WebGL2",
    `${linearize ? "linearized" : "direct"}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter<LevelsOptions>({
  name: "Levels",
  func: levelsFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
