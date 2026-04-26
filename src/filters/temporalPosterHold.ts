import { ACTION, RANGE } from "constants/controlTypes";
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
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5, desc: "Number of posterized tone bands in the held result" },
  holdThreshold: { type: RANGE, range: [0, 96], step: 1, default: 18, desc: "Tone change required before a held band begins to release" },
  releaseSpeed: { type: RANGE, range: [0.05, 1], step: 0.05, default: 0.25, desc: "How quickly a conflicting tone pushes the held band to update" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  levels: optionTypes.levels.default,
  holdThreshold: optionTypes.holdThreshold.default,
  releaseSpeed: optionTypes.releaseSpeed.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalPosterHoldOptions = FilterOptionValues & {
  levels?: number;
  holdThreshold?: number;
  releaseSpeed?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

// State texture layout: R = held band index normalized (band/(levels-1)),
// G = hold pressure (0..1). Ping-pong between two textures by frame parity.
const STATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prevState;
uniform float u_levels;
uniform float u_holdThreshold; // 0..1
uniform float u_releaseSpeed;
uniform float u_isFirst;

void main() {
  vec3 c = texture(u_source, v_uv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float maxBand = u_levels - 1.0;
  float targetBand = clamp(floor(luma * maxBand + 0.5), 0.0, maxBand);

  vec4 prev = texture(u_prevState, v_uv);
  float currentBand = floor(prev.r * maxBand + 0.5);
  float pressure = prev.g;

  if (u_isFirst > 0.5) {
    currentBand = targetBand;
    pressure = 0.0;
  } else if (targetBand == currentBand) {
    pressure = max(0.0, pressure - u_releaseSpeed * 0.5);
  } else {
    float currentLuma = u_levels <= 1.0 ? 0.0 : currentBand / maxBand;
    float targetLuma  = u_levels <= 1.0 ? 0.0 : targetBand / maxBand;
    float delta = abs(targetLuma - currentLuma);
    if (delta > u_holdThreshold) {
      float push = (delta - u_holdThreshold) / max(1.0/255.0, 1.0 - u_holdThreshold) + 0.15;
      pressure += push * u_releaseSpeed;
      if (pressure >= 1.0) { currentBand = targetBand; pressure = 0.0; }
    } else {
      pressure = max(0.0, pressure - u_releaseSpeed * 0.25);
    }
  }

  fragColor = vec4(currentBand / max(1.0, maxBand), pressure, 0.0, 1.0);
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_state;
uniform float u_levels;

void main() {
  vec4 c = texture(u_source, v_uv);
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float maxBand = u_levels - 1.0;
  float band = floor(texture(u_state, v_uv).r * maxBand + 0.5);
  float heldLuma = u_levels <= 1.0 ? 0.0 : band / maxBand;
  float scale = heldLuma / max(1.0/255.0, luma);
  fragColor = vec4(clamp(c.rgb * scale, 0.0, 1.0), c.a);
}
`;

let _stateProg: Program | null = null;
let _renderProg: Program | null = null;
let _lastLevels = -1;

const getStateProg = (gl: WebGL2RenderingContext): Program => {
  if (_stateProg) return _stateProg;
  _stateProg = linkProgram(gl, STATE_FS, [
    "u_source", "u_prevState", "u_levels",
    "u_holdThreshold", "u_releaseSpeed", "u_isFirst",
  ] as const);
  return _stateProg;
};

const getRenderProg = (gl: WebGL2RenderingContext): Program => {
  if (_renderProg) return _renderProg;
  _renderProg = linkProgram(gl, RENDER_FS, ["u_source", "u_state", "u_levels"] as const);
  return _renderProg;
};

const temporalPosterHold = (input: any, options: TemporalPosterHoldOptions = defaults) => {
  const levels = Math.max(2, Math.round(Number(options.levels ?? defaults.levels)));
  const holdThreshold = Math.max(0, Number(options.holdThreshold ?? defaults.holdThreshold));
  const releaseSpeed = Math.max(0.01, Number(options.releaseSpeed ?? defaults.releaseSpeed));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const stateProg = getStateProg(gl);
  const renderProg = getRenderProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "temporalPosterHold:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const stateA = ensureTexture(gl, "temporalPosterHold:stateA", W, H);
  const stateB = ensureTexture(gl, "temporalPosterHold:stateB", W, H);
  const writeState = frameIndex % 2 === 0 ? stateA : stateB;
  const readState  = frameIndex % 2 === 0 ? stateB : stateA;
  const isFirst = frameIndex === 0 || _lastLevels !== levels;
  _lastLevels = levels;

  drawPass(gl, writeState, W, H, stateProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(stateProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readState.tex);
    gl.uniform1i(stateProg.uniforms.u_prevState, 1);
    gl.uniform1f(stateProg.uniforms.u_levels, levels);
    gl.uniform1f(stateProg.uniforms.u_holdThreshold, holdThreshold / 255);
    gl.uniform1f(stateProg.uniforms.u_releaseSpeed, releaseSpeed);
    gl.uniform1f(stateProg.uniforms.u_isFirst, isFirst ? 1 : 0);
  }, vao);

  drawPass(gl, null, W, H, renderProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(renderProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, writeState.tex);
    gl.uniform1i(renderProg.uniforms.u_state, 1);
    gl.uniform1f(renderProg.uniforms.u_levels, levels);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Poster Hold", "WebGL2", `levels=${levels}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Poster Hold",
  func: temporalPosterHold,
  optionTypes,
  options: defaults,
  defaults,
  description: "Posterized tone bands update with temporal hysteresis so broad regions stick before snapping to a new tone",
  temporal: true,
  requiresGL: true,
});
