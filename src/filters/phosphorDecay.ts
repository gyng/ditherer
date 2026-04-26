import { RANGE, ACTION } from "constants/controlTypes";
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
  redDecay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.15, desc: "Red channel persistence — higher = faster fade" },
  greenDecay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.05, desc: "Green channel persistence — slowest (like real P22 phosphors)" },
  blueDecay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.2, desc: "Blue channel persistence — fastest fade" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  redDecay: optionTypes.redDecay.default,
  greenDecay: optionTypes.greenDecay.default,
  blueDecay: optionTypes.blueDecay.default,
  animSpeed: optionTypes.animSpeed.default,
};

type PhosphorDecayOptions = FilterOptionValues & {
  redDecay?: number;
  greenDecay?: number;
  blueDecay?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_history;
uniform vec3  u_retain;
uniform float u_haveHist;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  if (u_haveHist > 0.5) {
    vec3 hist = texture(u_history, v_uv).rgb * u_retain;
    fragColor = vec4(max(cur, hist), 1.0);
  } else {
    fragColor = vec4(cur, 1.0);
  }
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, ["u_source", "u_history", "u_retain", "u_haveHist"] as const);
  return _prog;
};

const phosphorDecay = (input: any, options: PhosphorDecayOptions = defaults) => {
  const redDecay = Number(options.redDecay ?? defaults.redDecay);
  const greenDecay = Number(options.greenDecay ?? defaults.greenDecay);
  const blueDecay = Number(options.blueDecay ?? defaults.blueDecay);
  const prev = options._prevOutput ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "phosphorDecay:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const histEntry = ensureTexture(gl, "phosphorDecay:history", W, H);
  const haveHist = !!prev && prev.length === W * H * 4;
  if (haveHist) {
    gl.bindTexture(gl.TEXTURE_2D, histEntry.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prev!);
  }

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, haveHist ? histEntry.tex : sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_history, 1);
    gl.uniform3f(prog.uniforms.u_retain, 1 - redDecay, 1 - greenDecay, 1 - blueDecay);
    gl.uniform1f(prog.uniforms.u_haveHist, haveHist ? 1 : 0);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Phosphor Decay", "WebGL2", `r=${redDecay} g=${greenDecay} b=${blueDecay}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Phosphor Decay",
  func: phosphorDecay,
  optionTypes,
  options: defaults,
  defaults,
  description: "CRT phosphor persistence — each RGB channel decays at a different rate",
  temporal: true,
  requiresGL: true,
});
