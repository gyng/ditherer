import { ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

const CHANNELS = { RGB: "RGB", LUMA: "LUMA", CHROMA: "CHROMA" };
const TRANSFORM = { REVERSIBLE_53: "REVERSIBLE_53", IRREVERSIBLE_97: "IRREVERSIBLE_97" };

export const optionTypes = {
  transform: {
    type: ENUM,
    options: [
      { name: "5/3-derived profile", value: TRANSFORM.REVERSIBLE_53 },
      { name: "9/7-derived profile", value: TRANSFORM.IRREVERSIBLE_97 },
    ],
    default: TRANSFORM.IRREVERSIBLE_97,
    desc: "Kernel profile derived from JPEG 2000's 5/3 or 9/7 analysis filters",
  },
  scale: {
    type: ENUM,
    options: [
      { name: "2 px", value: 2 },
      { name: "4 px", value: 4 },
      { name: "8 px", value: 8 },
    ],
    default: 4,
    desc: "Base spacing for the first undecimated multiscale decomposition level",
  },
  levels: {
    type: RANGE,
    range: [1, 4],
    step: 1,
    default: 3,
    desc: "Number of dyadic, undecimated detail levels",
  },
  channels: {
    type: ENUM,
    options: [
      { name: "RGB", value: CHANNELS.RGB },
      { name: "Luma detail", value: CHANNELS.LUMA },
      { name: "Chroma detail", value: CHANNELS.CHROMA },
    ],
    default: CHANNELS.LUMA,
    desc: "Color components most affected by coefficient loss",
  },
  quality: {
    type: RANGE,
    range: [1, 100],
    step: 1,
    default: 38,
    desc: "Coefficient precision; lower values produce stronger codec breakup",
  },
  detailLoss: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.72,
    desc: "Attenuation of horizontal, vertical, and diagonal detail bands",
  },
  bitplaneDrop: {
    type: RANGE,
    range: [0, 7],
    step: 1,
    default: 2,
    desc: "Discard simulated least-significant coefficient bit-planes",
  },
  codeblockLoss: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.04,
    desc: "Drop deterministic 32x32 simulated coefficient blocks",
  },
  ringing: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.22,
    desc: "Haloing around reconstructed high-contrast edges",
  },
  randomSeed: {
    type: RANGE,
    range: [0, 9999],
    step: 1,
    default: 2000,
    desc: "Deterministic code-block loss seed",
  },
};

export const defaults = {
  transform: optionTypes.transform.default,
  scale: optionTypes.scale.default,
  levels: optionTypes.levels.default,
  channels: optionTypes.channels.default,
  quality: optionTypes.quality.default,
  detailLoss: optionTypes.detailLoss.default,
  bitplaneDrop: optionTypes.bitplaneDrop.default,
  codeblockLoss: optionTypes.codeblockLoss.default,
  ringing: optionTypes.ringing.default,
  randomSeed: optionTypes.randomSeed.default,
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_quantStep;
uniform float u_detailKeep;
uniform float u_ringing;
uniform int u_channels;
uniform int u_transform;
uniform int u_levels;
uniform float u_bitplaneDrop;
uniform float u_codeblockLoss;
uniform float u_seed;
uniform int u_lossless;

vec2 uvAt(vec2 p) {
  vec2 q = clamp(p, vec2(0.5), u_res - vec2(0.5));
  return vec2(q.x / u_res.x, 1.0 - q.y / u_res.y);
}
vec3 quantizeSigned(vec3 value) {
  if (u_lossless == 1) return value;
  vec3 q = sign(value) * floor(abs(value) / u_quantStep + vec3(0.5));
  float plane = exp2(u_bitplaneDrop);
  q = sign(q) * floor(abs(q) / plane) * plane;
  return q * u_quantStep;
}

float hash(vec2 p) { return fract(sin(dot(p + u_seed, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 sourceAt(vec2 p) { return texture(u_source, uvAt(p)).rgb; }

vec3 lowpass53(vec2 p, float stepSize) {
  vec3 h = sourceAt(p) * 0.75
    + (sourceAt(p - vec2(stepSize, 0.0)) + sourceAt(p + vec2(stepSize, 0.0))) * 0.25
    - (sourceAt(p - vec2(stepSize * 2.0, 0.0)) + sourceAt(p + vec2(stepSize * 2.0, 0.0))) * 0.125;
  vec3 v = sourceAt(p) * 0.75
    + (sourceAt(p - vec2(0.0, stepSize)) + sourceAt(p + vec2(0.0, stepSize))) * 0.25
    - (sourceAt(p - vec2(0.0, stepSize * 2.0)) + sourceAt(p + vec2(0.0, stepSize * 2.0))) * 0.125;
  return (h + v) * 0.5;
}

vec3 lowpass97Axis(vec2 p, vec2 axis) {
  return sourceAt(p) * 0.602949018236
    + (sourceAt(p - axis) + sourceAt(p + axis)) * 0.266864118443
    - (sourceAt(p - axis * 2.0) + sourceAt(p + axis * 2.0)) * 0.078223266529
    - (sourceAt(p - axis * 3.0) + sourceAt(p + axis * 3.0)) * 0.016864118443
    + (sourceAt(p - axis * 4.0) + sourceAt(p + axis * 4.0)) * 0.026748757411;
}

vec3 lowpass97(vec2 p, float stepSize) {
  return (lowpass97Axis(p, vec2(stepSize, 0.0)) + lowpass97Axis(p, vec2(0.0, stepSize))) * 0.5;
}

void main() {
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec3 original = sourceAt(pixel);
  vec3 reconstructed = original;
  vec3 previousLow = original;
  float stepSize = max(1.0, u_scale * 0.25);
  for (int level = 0; level < 4; level++) {
    if (level >= u_levels) break;
    vec3 low = u_transform == 0 ? lowpass53(pixel, stepSize) : lowpass97(pixel, stepSize);
    vec3 detail = previousLow - low;
    vec2 codeblock = floor(pixel / 32.0) + vec2(float(level) * 131.0, 0.0);
    float keepBlock = hash(codeblock) < u_codeblockLoss ? 0.0 : 1.0;
    vec3 processedDetail = quantizeSigned(detail) * u_detailKeep * keepBlock;
    reconstructed += processedDetail - detail;
    previousLow = low;
    stepSize *= 2.0;
  }

  float originalLuma = dot(original, vec3(0.2126, 0.7152, 0.0722));
  float reconstructedLuma = dot(reconstructed, vec3(0.2126, 0.7152, 0.0722));
  if (u_channels == 1) {
    reconstructed = original + vec3(reconstructedLuma - originalLuma);
  } else if (u_channels == 2) {
    reconstructed += vec3(originalLuma - reconstructedLuma);
  }

  vec2 ringStep = vec2(max(1.0, u_scale * 0.5) / u_res.x, 0.0);
  vec3 neighborhood = (texture(u_source, clamp(v_uv - ringStep, vec2(0.0), vec2(1.0))).rgb
    + texture(u_source, clamp(v_uv + ringStep, vec2(0.0), vec2(1.0))).rgb) * 0.5;
  reconstructed += (original - neighborhood) * u_ringing;
  fragColor = vec4(clamp(reconstructed, 0.0, 1.0), texture(u_source, v_uv).a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source",
    "u_res",
    "u_scale",
    "u_quantStep",
    "u_detailKeep",
    "u_ringing",
    "u_channels",
    "u_transform",
    "u_levels",
    "u_bitplaneDrop",
    "u_codeblockLoss",
    "u_seed",
    "u_lossless",
  ] as const);
  return _prog;
};
const channelId: Record<string, number> = { RGB: 0, LUMA: 1, CHROMA: 2 };

type WaveletOptions = FilterOptionValues & Partial<typeof defaults>;

const finiteClamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const numeric = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(numeric) ? numeric : fallback));
};

const waveletCodec = (input: any, options: WaveletOptions = defaults) => {
  const W = input.width,
    H = input.height;
  if (W < 1 || H < 1) return input;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "waveletCodec:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const transform =
    String(options.transform) === TRANSFORM.REVERSIBLE_53
      ? TRANSFORM.REVERSIBLE_53
      : TRANSFORM.IRREVERSIBLE_97;
  const scale = [2, 4, 8].includes(Number(options.scale)) ? Number(options.scale) : defaults.scale;
  const levels = Math.round(finiteClamp(options.levels, defaults.levels, 1, 4));
  const quality = Math.round(finiteClamp(options.quality, defaults.quality, 1, 100));
  const detailLoss = finiteClamp(options.detailLoss, defaults.detailLoss, 0, 1);
  const bitplaneDrop = Math.round(finiteClamp(options.bitplaneDrop, defaults.bitplaneDrop, 0, 7));
  const codeblockLoss = finiteClamp(options.codeblockLoss, defaults.codeblockLoss, 0, 1);
  const ringing = finiteClamp(options.ringing, defaults.ringing, 0, 1);
  const randomSeed = finiteClamp(options.randomSeed, defaults.randomSeed, 0, 9999);
  const lossless =
    transform === TRANSFORM.REVERSIBLE_53 &&
    quality === 100 &&
    detailLoss === 0 &&
    bitplaneDrop === 0 &&
    codeblockLoss === 0 &&
    ringing === 0;
  const quantStep = 0.002 + Math.pow((101 - quality) / 100, 1.6) * 0.28;
  drawPass(
    gl,
    null,
    W,
    H,
    prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.uniform2f(prog.uniforms.u_res, W, H);
      gl.uniform1f(prog.uniforms.u_scale, scale);
      gl.uniform1f(prog.uniforms.u_quantStep, quantStep);
      gl.uniform1f(prog.uniforms.u_detailKeep, 1 - detailLoss);
      gl.uniform1f(prog.uniforms.u_ringing, ringing);
      gl.uniform1i(prog.uniforms.u_channels, channelId[String(options.channels)] ?? 1);
      gl.uniform1i(prog.uniforms.u_transform, transform === TRANSFORM.REVERSIBLE_53 ? 0 : 1);
      gl.uniform1i(prog.uniforms.u_levels, levels);
      gl.uniform1f(prog.uniforms.u_bitplaneDrop, bitplaneDrop);
      gl.uniform1f(prog.uniforms.u_codeblockLoss, codeblockLoss);
      gl.uniform1f(prog.uniforms.u_seed, randomSeed);
      gl.uniform1i(prog.uniforms.u_lossless, lossless ? 1 : 0);
    },
    vao,
  );
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend(
    "Wavelet Codec",
    "WebGL2",
    `${transform} levels=${levels} quality=${quality}${lossless ? " lossless" : ""}`,
  );
  return output;
};

export default defineFilter({
  name: "Wavelet Codec",
  func: waveletCodec,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "JPEG 2000-inspired undecimated multiscale decomposition with 5/3- or 9/7-derived kernels, bit-plane loss and code-block damage",
  requiresGL: true,
});
