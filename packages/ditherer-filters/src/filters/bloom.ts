import { RANGE, ENUM } from "../constants/controlTypes";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { normalizeEnumOption, normalizeRangeOption } from "../utils/filterOptions";
import { SRGB_GLSL, sigmaForRadius } from "./opticalConvolutionContracts";
import {
  drawPass,
  ensureFloatTexture,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
  type TexEntry,
} from "../gl/index";

const THRESHOLD_ABSOLUTE = "ABSOLUTE";
const THRESHOLD_RELATIVE = "RELATIVE";

export const optionTypes = {
  thresholdMode: {
    type: ENUM,
    options: [
      { name: "Absolute (0–255)", value: THRESHOLD_ABSOLUTE },
      { name: "Relative (% of max)", value: THRESHOLD_RELATIVE },
    ],
    default: THRESHOLD_ABSOLUTE,
  },
  threshold: {
    type: RANGE,
    range: [0, 255],
    step: 1,
    default: 180,
    desc: "Brightness cutoff — only pixels above this value glow",
  },
  strength: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 0.8,
    desc: "Intensity of the additive glow composite",
  },
  radius: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 8,
    desc: "Blur radius for the glow spread",
  },
};

export const defaults = {
  thresholdMode: optionTypes.thresholdMode.default,
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
};

const MAX_BLOOM_RADIUS = 30;

// Bright pass in linear light: keep only the energy above the threshold, so
// the glow represents the actual radiant energy of bright sources (the
// previous filter thresholded and composited in gamma space).
const BLOOM_EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_threshold;   // sRGB 0..1
${SRGB_GLSL}
void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 lin = oc_srgbToLinear(c.rgb);
  float tLin = oc_srgbToLinear(vec3(u_threshold)).r;
  fragColor = vec4(max(vec3(0.0), lin - tLin), c.a);
}
`;

// Gaussian blur pass over the (linear) bright field; run repeatedly to build
// widening scales.
const BLOOM_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_axis;
uniform int   u_radius;
uniform float u_sigma;
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float inv2s2 = 1.0 / (2.0 * u_sigma * u_sigma);
  for (int k = -${MAX_BLOOM_RADIUS}; k <= ${MAX_BLOOM_RADIUS}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float w = exp(-float(k * k) * inv2s2);
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    acc += w * texture(u_input, vec2((nx+0.5)/u_res.x, (ny+0.5)/u_res.y)).rgb;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}
`;

// Additive composite in linear light of three widening bloom scales.
const BLOOM_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_b1;
uniform sampler2D u_b2;
uniform sampler2D u_b3;
uniform float u_strength;
${SRGB_GLSL}
void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 srcLin = oc_srgbToLinear(src.rgb);
  vec3 bloom = texture(u_b1, v_uv).rgb * 0.5
             + texture(u_b2, v_uv).rgb * 0.3
             + texture(u_b3, v_uv).rgb * 0.2;
  vec3 outLin = srcLin + bloom * u_strength;
  fragColor = vec4(oc_linearToSrgb(outLin), src.a);
}
`;

type GLCache = { extract: Program; blur: Program; composite: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    extract: linkProgram(gl, BLOOM_EXTRACT_FS, ["u_source", "u_threshold"] as const),
    blur: linkProgram(gl, BLOOM_BLUR_FS, [
      "u_input",
      "u_res",
      "u_axis",
      "u_radius",
      "u_sigma",
    ] as const),
    composite: linkProgram(gl, BLOOM_COMPOSITE_FS, [
      "u_source",
      "u_b1",
      "u_b2",
      "u_b3",
      "u_strength",
    ] as const),
  };
  return _glCache;
};

const bloom = (input: any, options: Partial<typeof defaults> = defaults) => {
  const thresholdMode = normalizeEnumOption(
    options.thresholdMode,
    [THRESHOLD_ABSOLUTE, THRESHOLD_RELATIVE],
    defaults.thresholdMode,
  );
  const strength = normalizeRangeOption(options.strength, defaults.strength, 0, 3);
  const radius = normalizeRangeOption(options.radius, defaults.radius, 1, MAX_BLOOM_RADIUS, true);
  const thresholdRaw = normalizeRangeOption(options.threshold, defaults.threshold, 0, 255);
  const W = input.width,
    H = input.height;

  // Resolve threshold (CPU — relative mode needs a reduction over all pixels).
  let threshold = thresholdRaw;
  if (thresholdMode === THRESHOLD_RELATIVE) {
    const inputCtx = input.getContext("2d");
    if (inputCtx) {
      const buf = inputCtx.getImageData(0, 0, W, H).data;
      let maxLum = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const lum = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
        if (lum > maxLum) maxLum = lum;
      }
      threshold = maxLum * (thresholdRaw / 255);
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
  // The bright pass and its blurs hold linear-light energy; use RGBA16F where
  // available so the smooth glow tail does not band, falling back to 8-bit.
  const linTex = (name: string): TexEntry =>
    ensureFloatTexture(gl, name, W, H) ?? ensureTexture(gl, name, W, H);
  const extractTex: TexEntry = linTex("bloom:extract");
  const tmpTex: TexEntry = linTex("bloom:tmp");
  const scaleTex: TexEntry[] = [linTex("bloom:b1"), linTex("bloom:b2"), linTex("bloom:b3")];

  const sigma = sigmaForRadius(radius * 2);
  const loopRadius = Math.min(MAX_BLOOM_RADIUS, Math.max(1, Math.ceil(sigma * 3)));
  const gaussianPass = (src: TexEntry, dst: TexEntry, axisX: number, axisY: number): void => {
    drawPass(
      gl,
      dst,
      W,
      H,
      cache.blur,
      () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(cache.blur.uniforms.u_input, 0);
        gl.uniform2f(cache.blur.uniforms.u_res, W, H);
        gl.uniform2f(cache.blur.uniforms.u_axis, axisX, axisY);
        gl.uniform1i(cache.blur.uniforms.u_radius, loopRadius);
        gl.uniform1f(cache.blur.uniforms.u_sigma, sigma);
      },
      vao,
    );
  };

  drawPass(
    gl,
    extractTex,
    W,
    H,
    cache.extract,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.extract.uniforms.u_source, 0);
      gl.uniform1f(cache.extract.uniforms.u_threshold, threshold / 255);
    },
    vao,
  );

  // Progressive blur: each scale re-blurs the previous, widening the glow.
  let previous = extractTex;
  for (const scale of scaleTex) {
    gaussianPass(previous, tmpTex, 1, 0);
    gaussianPass(tmpTex, scale, 0, 1);
    previous = scale;
  }

  drawPass(
    gl,
    null,
    W,
    H,
    cache.composite,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.composite.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, scaleTex[0].tex);
      gl.uniform1i(cache.composite.uniforms.u_b1, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, scaleTex[1].tex);
      gl.uniform1i(cache.composite.uniforms.u_b2, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, scaleTex[2].tex);
      gl.uniform1i(cache.composite.uniforms.u_b3, 3);
      gl.uniform1f(cache.composite.uniforms.u_strength, strength);
    },
    vao,
  );

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  logFilterBackend(
    "Bloom",
    "WebGL2",
    `radius=${radius} thresh=${threshold.toFixed(0)} linear-multiscale`,
  );
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
