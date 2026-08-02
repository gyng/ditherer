import { ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { SRGB_GLSL } from "./opticalConvolutionContracts";
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

const DIRECTION = { UP: "UP", DOWN: "DOWN", BOTH: "BOTH" };

export const optionTypes = {
  threshold: {
    type: RANGE,
    range: [0.5, 0.99],
    step: 0.01,
    default: 0.78,
    desc: "Normalized full-well level above which pixels spill excess charge",
  },
  strength: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 0.8,
    desc: "Gain applied to accumulated excess charge in the vertical trail",
  },
  length: {
    type: RANGE,
    range: [1, 32],
    step: 1,
    default: 18,
    desc: "Maximum smear length in pixels",
  },
  decay: {
    type: RANGE,
    range: [0.5, 0.98],
    step: 0.01,
    default: 0.86,
    desc: "How slowly spilled charge fades along the column",
  },
  direction: {
    type: ENUM,
    options: [
      { name: "Up", value: DIRECTION.UP },
      { name: "Down", value: DIRECTION.DOWN },
      { name: "Both", value: DIRECTION.BOTH },
    ],
    default: DIRECTION.DOWN,
    desc: "Column direction in which the simulated overflow charge propagates",
  },
  antiBlooming: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.2,
    desc: "Fraction of excess charge removed by a simulated anti-blooming drain",
  },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  length: optionTypes.length.default,
  decay: optionTypes.decay.default,
  direction: optionTypes.direction.default,
  antiBlooming: optionTypes.antiBlooming.default,
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_threshold;
uniform float u_strength;
uniform float u_decay;
uniform float u_antiBlooming;
uniform int u_length;
uniform int u_direction;
${SRGB_GLSL}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 source = texture(u_source, v_uv);
  // Zero strength is an exact identity by construction: skip the linear
  // round-trip (whose ~1e-6 pow error, while sub-quantization, is not
  // guaranteed bit-exact across drivers) and pass the source straight through.
  if (u_strength <= 0.0) { fragColor = source; return; }
  // Sensor charge is proportional to LINEAR photon count, not the
  // gamma-encoded pixel value: the full-well threshold, the excess above it,
  // and the additive spill must all be computed in linear light. u_threshold
  // is exposed as a perceptual (sRGB) control, so it is linearized once here
  // to match the linearized samples it is compared against.
  float thresholdLin = oc_srgbToLinear(vec3(u_threshold)).r;
  vec3 spilledCharge = vec3(0.0);
  for (int i = 1; i <= 32; i++) {
    if (i > u_length) continue;
    float fi = float(i);
    float weight = pow(u_decay, fi);
    if (u_direction == 0 || u_direction == 2) {
      float sampleY = v_uv.y + fi / u_res.y;
      if (sampleY <= 1.0) {
        vec3 c = oc_srgbToLinear(texture(u_source, vec2(v_uv.x, sampleY)).rgb);
        float excess = max(0.0, luma(c) - thresholdLin) / max(0.001, 1.0 - thresholdLin);
        vec3 spectralRatio = c / max(0.001, max(c.r, max(c.g, c.b)));
        spilledCharge += spectralRatio * excess * weight;
      }
    }
    if (u_direction == 1 || u_direction == 2) {
      float sampleY = v_uv.y - fi / u_res.y;
      if (sampleY >= 0.0) {
        vec3 c = oc_srgbToLinear(texture(u_source, vec2(v_uv.x, sampleY)).rgb);
        float excess = max(0.0, luma(c) - thresholdLin) / max(0.001, 1.0 - thresholdLin);
        vec3 spectralRatio = c / max(0.001, max(c.r, max(c.g, c.b)));
        spilledCharge += spectralRatio * excess * weight;
      }
    }
  }
  float drain = 1.0 - clamp(u_antiBlooming, 0.0, 1.0);
  vec3 rgbLin = oc_srgbToLinear(source.rgb) + spilledCharge * max(0.0, u_strength) * drain;
  fragColor = vec4(clamp(oc_linearToSrgb(rgbLin), 0.0, 1.0), source.a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source",
    "u_res",
    "u_threshold",
    "u_strength",
    "u_decay",
    "u_antiBlooming",
    "u_length",
    "u_direction",
  ] as const);
  return _prog;
};

const boundedOption = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

const ccdChargeSmear = (input: any, options = defaults) => {
  const W = input.width,
    H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "ccdChargeSmear:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const threshold = boundedOption(options.threshold, defaults.threshold, 0.5, 0.99);
  const strength = boundedOption(options.strength, defaults.strength, 0, 3);
  const decay = boundedOption(options.decay, defaults.decay, 0.5, 0.98);
  const antiBlooming = boundedOption(options.antiBlooming, defaults.antiBlooming, 0, 1);
  const length = Math.round(boundedOption(options.length, defaults.length, 1, 32));
  const direction =
    options.direction === DIRECTION.UP || options.direction === DIRECTION.BOTH
      ? options.direction
      : DIRECTION.DOWN;
  // GL texture Y grows upward while canvas/display Y grows downward. A DOWN
  // trail therefore gathers overload from the higher texture coordinate.
  const directionId = direction === DIRECTION.DOWN ? 0 : direction === DIRECTION.BOTH ? 2 : 1;
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
      gl.uniform1f(prog.uniforms.u_threshold, threshold);
      gl.uniform1f(prog.uniforms.u_strength, strength);
      gl.uniform1f(prog.uniforms.u_decay, decay);
      gl.uniform1f(prog.uniforms.u_antiBlooming, antiBlooming);
      gl.uniform1i(prog.uniforms.u_length, length);
      gl.uniform1i(prog.uniforms.u_direction, directionId);
    },
    vao,
  );
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("CCD Charge Smear", "WebGL2", `${direction} len=${length}`);
  return output;
};

export default defineFilter({
  name: "CCD Charge Smear",
  func: ccdChargeSmear,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Visible-light proxy for CCD full-well overflow, with additive column blooming and an anti-blooming drain",
  requiresGL: true,
});
