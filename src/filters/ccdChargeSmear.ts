import { ENUM, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glUnavailableStub,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const DIRECTION = { UP: "UP", DOWN: "DOWN", BOTH: "BOTH" };

export const optionTypes = {
  threshold: { type: RANGE, range: [0.5, 1], step: 0.01, default: 0.78, desc: "Brightness where sensor wells begin spilling charge" },
  strength: { type: RANGE, range: [0, 3], step: 0.05, default: 1.15, desc: "Intensity of the vertical charge trail" },
  length: { type: RANGE, range: [1, 32], step: 1, default: 18, desc: "Maximum smear length in pixels" },
  decay: { type: RANGE, range: [0.5, 0.98], step: 0.01, default: 0.86, desc: "How slowly spilled charge fades along the column" },
  direction: {
    type: ENUM,
    options: [
      { name: "Up", value: DIRECTION.UP },
      { name: "Down", value: DIRECTION.DOWN },
      { name: "Both", value: DIRECTION.BOTH },
    ],
    default: DIRECTION.DOWN,
    desc: "Charge-transfer direction on the simulated sensor",
  },
  channelBias: { type: RANGE, range: [-1, 1], step: 0.05, default: 0.25, desc: "Bias smear toward blue (negative) or red (positive)" },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  length: optionTypes.length.default,
  decay: optionTypes.decay.default,
  direction: optionTypes.direction.default,
  channelBias: optionTypes.channelBias.default,
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
uniform float u_channelBias;
uniform int u_length;
uniform int u_direction;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 source = texture(u_source, v_uv);
  vec3 smear = vec3(0.0);
  float weightSum = 0.0;
  for (int i = 1; i <= 32; i++) {
    if (i > u_length) continue;
    float fi = float(i);
    float weight = pow(u_decay, fi);
    if (u_direction == 0 || u_direction == 2) {
      vec3 c = texture(u_source, clamp(v_uv + vec2(0.0, fi / u_res.y), vec2(0.0), vec2(1.0))).rgb;
      float hot = max(0.0, luma(c) - u_threshold) / max(0.001, 1.0 - u_threshold);
      smear += c * hot * weight;
      weightSum += hot * weight;
    }
    if (u_direction == 1 || u_direction == 2) {
      vec3 c = texture(u_source, clamp(v_uv - vec2(0.0, fi / u_res.y), vec2(0.0), vec2(1.0))).rgb;
      float hot = max(0.0, luma(c) - u_threshold) / max(0.001, 1.0 - u_threshold);
      smear += c * hot * weight;
      weightSum += hot * weight;
    }
  }
  vec3 bias = vec3(1.0 + max(0.0, u_channelBias) * 0.35, 1.0, 1.0 + max(0.0, -u_channelBias) * 0.35);
  vec3 trail = weightSum > 0.0 ? smear / weightSum : vec3(0.0);
  float spill = min(1.0, weightSum * (1.0 - u_decay) * u_strength);
  vec3 rgb = source.rgb + trail * bias * spill;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), source.a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_threshold", "u_strength", "u_decay",
    "u_channelBias", "u_length", "u_direction",
  ] as const);
  return _prog;
};

const ccdChargeSmear = (input: any, options = defaults) => {
  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "ccdChargeSmear:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const directionId = options.direction === DIRECTION.UP ? 0 : options.direction === DIRECTION.BOTH ? 2 : 1;
  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_threshold, options.threshold);
    gl.uniform1f(prog.uniforms.u_strength, options.strength);
    gl.uniform1f(prog.uniforms.u_decay, options.decay);
    gl.uniform1f(prog.uniforms.u_channelBias, options.channelBias);
    gl.uniform1i(prog.uniforms.u_length, Math.max(1, Math.min(32, Math.round(options.length))));
    gl.uniform1i(prog.uniforms.u_direction, directionId);
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("CCD Charge Smear", "WebGL2", `${options.direction} len=${options.length}`);
  return output;
};

export default defineFilter({
  name: "CCD Charge Smear",
  func: ccdChargeSmear,
  optionTypes,
  options: defaults,
  defaults,
  description: "Overloaded CCD highlights spill charge into directional vertical sensor trails",
  requiresGL: true,
});
