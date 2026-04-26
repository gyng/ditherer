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
  keyframeInterval: { type: RANGE, range: [2, 30], step: 1, default: 8, desc: "How many frames pass before a new keyframe is captured" },
  smear: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "How strongly the held keyframe drags into the in-between frames" },
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
  keyframeInterval: optionTypes.keyframeInterval.default,
  smear: optionTypes.smear.default,
  animSpeed: optionTypes.animSpeed.default,
};

type KeyframeSmearOptions = FilterOptionValues & {
  keyframeInterval?: number;
  smear?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_keyframe;
uniform float u_smearMix;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  vec3 key = texture(u_keyframe, v_uv).rgb;
  fragColor = vec4(key * u_smearMix + cur * (1.0 - u_smearMix), 1.0);
}
`;

let _prog: Program | null = null;
let _intervalCache = 0;
let _framesSinceCapture = 0;
let _lastFrameIndex = -1;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, ["u_source", "u_keyframe", "u_smearMix"] as const);
  return _prog;
};

const keyframeSmear = (input: any, options: KeyframeSmearOptions = defaults) => {
  const keyframeInterval = Math.max(2, Math.round(Number(options.keyframeInterval ?? defaults.keyframeInterval)));
  const smear = Math.max(0, Math.min(1, Number(options.smear ?? defaults.smear)));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "keyframeSmear:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const keyTex = ensureTexture(gl, "keyframeSmear:keyframe", W, H);
  const restarted = frameIndex === 0 && _lastFrameIndex > 0;
  if (_intervalCache !== keyframeInterval || restarted) {
    _intervalCache = keyframeInterval;
    _framesSinceCapture = keyframeInterval; // force capture this frame
  }
  if (_framesSinceCapture >= keyframeInterval) {
    gl.bindTexture(gl.TEXTURE_2D, keyTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
    _framesSinceCapture = 0;
  }
  _lastFrameIndex = frameIndex;

  const phase = Math.min(1, _framesSinceCapture / Math.max(1, keyframeInterval));
  const smearMix = smear * (1 - phase * 0.45);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, keyTex.tex);
    gl.uniform1i(prog.uniforms.u_keyframe, 1);
    gl.uniform1f(prog.uniforms.u_smearMix, smearMix);
  }, vao);

  _framesSinceCapture++;

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Keyframe Smear", "WebGL2", `interval=${keyframeInterval} smear=${smear}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Keyframe Smear",
  func: keyframeSmear,
  optionTypes,
  options: defaults,
  defaults,
  description: "Capture sparse keyframes and drag them through the in-between frames for compressed, smeared temporal interpolation",
  temporal: true,
  requiresGL: true,
});
