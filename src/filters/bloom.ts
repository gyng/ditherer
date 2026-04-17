import { RANGE, ENUM } from "constants/controlTypes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
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
  type TexEntry,
} from "gl";

const THRESHOLD_ABSOLUTE = "ABSOLUTE";
const THRESHOLD_RELATIVE = "RELATIVE";

export const optionTypes = {
  thresholdMode: {
    type: ENUM,
    options: [
      { name: "Absolute (0–255)", value: THRESHOLD_ABSOLUTE },
      { name: "Relative (% of max)", value: THRESHOLD_RELATIVE }
    ],
    default: THRESHOLD_ABSOLUTE
  },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 180, desc: "Brightness cutoff — only pixels above this value glow" },
  strength:  { type: RANGE, range: [0, 3], step: 0.05, default: 0.8, desc: "Intensity of the additive glow composite" },
  radius:    { type: RANGE, range: [1, 30], step: 1, default: 8, desc: "Blur radius for the glow spread" }
};

export const defaults = {
  thresholdMode: optionTypes.thresholdMode.default,
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default
};

const MAX_BLOOM_RADIUS = 30;

const BLOOM_EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_threshold;   // 0..1
void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(max(vec3(0.0), c.rgb - u_threshold), c.a);
}
`;

const BLOOM_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_axis;
uniform int   u_radius;
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  vec3 acc = vec3(0.0);
  float count = 0.0;
  for (int k = -${MAX_BLOOM_RADIUS}; k <= ${MAX_BLOOM_RADIUS}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    acc += texture(u_input, vec2((nx+0.5)/u_res.x, (ny+0.5)/u_res.y)).rgb;
    count += 1.0;
  }
  fragColor = vec4(acc / count, 1.0);
}
`;

const BLOOM_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_bloom;
uniform float u_strength;
void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  fragColor = vec4(min(vec3(1.0), src.rgb + bloom * u_strength), src.a);
}
`;

type GLCache = { extract: Program; blur: Program; composite: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    extract: linkProgram(gl, BLOOM_EXTRACT_FS, ["u_source", "u_threshold"] as const),
    blur: linkProgram(gl, BLOOM_BLUR_FS, ["u_input", "u_res", "u_axis", "u_radius"] as const),
    composite: linkProgram(gl, BLOOM_COMPOSITE_FS, ["u_source", "u_bloom", "u_strength"] as const),
  };
  return _glCache;
};

const bloom = (input: any, options: typeof defaults = defaults) => {
  const { thresholdMode, strength, radius } = options;
  const W = input.width, H = input.height;

  // Resolve threshold (CPU — relative mode needs a reduction over all pixels).
  let threshold = options.threshold;
  if (thresholdMode === THRESHOLD_RELATIVE) {
    const inputCtx = input.getContext("2d");
    if (inputCtx) {
      const buf = inputCtx.getImageData(0, 0, W, H).data;
      let maxLum = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const lum = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
        if (lum > maxLum) maxLum = lum;
      }
      threshold = maxLum * (options.threshold / 255);
    }
  }

  const ctx = getGLCtx();
  if (!ctx) return input;
  const { gl, canvas } = ctx;
  const cache = initGLCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "bloom:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const extractTex: TexEntry = ensureTexture(gl, "bloom:extract", W, H);
  const blurHTex: TexEntry = ensureTexture(gl, "bloom:blurH", W, H);
  const blurVTex: TexEntry = ensureTexture(gl, "bloom:blurV", W, H);

  drawPass(gl, extractTex, W, H, cache.extract, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.extract.uniforms.u_source, 0);
    gl.uniform1f(cache.extract.uniforms.u_threshold, threshold / 255);
  }, vao);

  drawPass(gl, blurHTex, W, H, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, extractTex.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, W, H);
    gl.uniform2f(cache.blur.uniforms.u_axis, 1, 0);
    gl.uniform1i(cache.blur.uniforms.u_radius, Math.min(MAX_BLOOM_RADIUS, radius));
  }, vao);

  drawPass(gl, blurVTex, W, H, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blurHTex.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, W, H);
    gl.uniform2f(cache.blur.uniforms.u_axis, 0, 1);
    gl.uniform1i(cache.blur.uniforms.u_radius, Math.min(MAX_BLOOM_RADIUS, radius));
  }, vao);

  drawPass(gl, null, W, H, cache.composite, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurVTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_bloom, 1);
    gl.uniform1f(cache.composite.uniforms.u_strength, strength);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  logFilterBackend("Bloom", "WebGL2", `radius=${radius} thresh=${threshold}`);
  return rendered;
};

export default defineFilter({
  name: "Bloom",
  func: bloom,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
