import { RANGE, BOOL, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
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
} from "gl";

export const optionTypes = {
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 15, desc: "Minimum temporal change to show as an edge" },
  sensitivity: { type: RANGE, range: [1, 10], step: 0.5, default: 3, desc: "Amplify edge brightness" },
  accumulate: { type: BOOL, default: true, desc: "Build up edges over time vs show only instantaneous changes" },
  decayRate: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.08, desc: "How fast accumulated edges fade" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  sensitivity: optionTypes.sensitivity.default,
  accumulate: optionTypes.accumulate.default,
  decayRate: optionTypes.decayRate.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalEdgeOptions = FilterOptionValues & {
  threshold?: number;
  sensitivity?: number;
  accumulate?: boolean;
  decayRate?: number;
  animSpeed?: number;
  _prevInput?: Uint8ClampedArray | null;
  _prevOutput?: Uint8ClampedArray | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prevInput;
uniform sampler2D u_prevOutput;
uniform float u_threshold;     // 0..1
uniform float u_sensitivity;
uniform float u_decayRetain;   // 1 - decayRate
uniform float u_havePrevInput;
uniform float u_haveAccum;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  vec3 edge = vec3(0.0);

  if (u_havePrevInput > 0.5) {
    vec3 pi = texture(u_prevInput, v_uv).rgb;
    vec3 d = abs(cur - pi);
    vec3 above = max(d - u_threshold, 0.0) * u_sensitivity;
    edge = clamp(above, 0.0, 1.0);
  }

  if (u_haveAccum > 0.5) {
    vec3 prevDecay = texture(u_prevOutput, v_uv).rgb * u_decayRetain;
    edge = max(edge, prevDecay);
  }

  fragColor = vec4(edge, 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_prevInput", "u_prevOutput",
    "u_threshold", "u_sensitivity", "u_decayRetain",
    "u_havePrevInput", "u_haveAccum",
  ] as const);
  return _prog;
};

const uploadHistory = (gl: WebGL2RenderingContext, tex: WebGLTexture, w: number, h: number, buf: Uint8ClampedArray) => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
};

const temporalEdge = (input: any, options: TemporalEdgeOptions = defaults) => {
  const threshold = Number(options.threshold ?? defaults.threshold);
  const sensitivity = Number(options.sensitivity ?? defaults.sensitivity);
  const accumulate = Boolean(options.accumulate ?? defaults.accumulate);
  const decayRate = Number(options.decayRate ?? defaults.decayRate);
  const prevInput = options._prevInput ?? null;
  const prevOutput = options._prevOutput ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "temporalEdge:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const prevInTex = ensureTexture(gl, "temporalEdge:prevInput", W, H);
  const prevOutTex = ensureTexture(gl, "temporalEdge:prevOutput", W, H);
  const havePrevInput = !!prevInput && prevInput.length === W * H * 4;
  const haveAccum = accumulate && !!prevOutput && prevOutput.length === W * H * 4;
  if (havePrevInput) uploadHistory(gl, prevInTex.tex, W, H, prevInput!);
  if (haveAccum) uploadHistory(gl, prevOutTex.tex, W, H, prevOutput!);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, havePrevInput ? prevInTex.tex : sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_prevInput, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, haveAccum ? prevOutTex.tex : sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_prevOutput, 2);
    gl.uniform1f(prog.uniforms.u_threshold, threshold / 255);
    gl.uniform1f(prog.uniforms.u_sensitivity, sensitivity);
    gl.uniform1f(prog.uniforms.u_decayRetain, 1 - decayRate);
    gl.uniform1f(prog.uniforms.u_havePrevInput, havePrevInput ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_haveAccum, haveAccum ? 1 : 0);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Temporal Edge", "WebGL2", `thresh=${threshold} sens=${sensitivity} accum=${accumulate}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Temporal Edge",
  func: temporalEdge,
  optionTypes,
  options: defaults,
  defaults,
  description: "Detect edges in time — moving edges glow, static edges are invisible",
  temporal: true,
  requiresGL: true,
});
