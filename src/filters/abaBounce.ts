import { ACTION, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas, logFilterBackend } from "utils";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  type Program,
} from "gl";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 2], step: 0.05, default: 1.1, desc: "How hard the third beat reflects backward from B toward and past A" },
  cadenceDrift: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "How much the emphasized bounce beat wanders between strict ABA timing and a looser variable-frame cadence" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  }},
};

export const defaults = {
  strength: optionTypes.strength.default,
  cadenceDrift: optionTypes.cadenceDrift.default,
  animSpeed: optionTypes.animSpeed.default,
};

type AbaBounceOptions = FilterOptionValues & typeof defaults & {
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_strength;

void main() {
  vec3 a = texture(u_a, v_uv).rgb;
  vec3 b = texture(u_b, v_uv).rgb;
  vec3 d = b - a;
  fragColor = vec4(clamp(a - d * u_strength, 0.0, 1.0), 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, ["u_a", "u_b", "u_strength"] as const);
  return _prog;
};

const computeEffectivePhase = (frameIndex: number, cadenceDrift: number) => {
  const phase = ((frameIndex % 3) + 3) % 3;
  const cadenceOffset = cadenceDrift <= 0
    ? 0
    : ((Math.sin(frameIndex * 0.91) + Math.sin(frameIndex * 0.37 + 1.7)) * 0.25 + 0.5) < cadenceDrift
      ? 1
      : 0;
  return (phase + cadenceOffset) % 3;
};

const abaBounce = (input: any, options: AbaBounceOptions = defaults) => {
  const strength = Math.max(0, Number(options.strength ?? defaults.strength));
  const cadenceDrift = Math.max(0, Math.min(1, Number(options.cadenceDrift ?? defaults.cadenceDrift)));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const aTex = ensureTexture(gl, "abaBounce:A", W, H);
  const bTex = ensureTexture(gl, "abaBounce:B", W, H);
  const phase = computeEffectivePhase(frameIndex, cadenceDrift);

  if (phase === 0) {
    gl.bindTexture(gl.TEXTURE_2D, aTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
    return cloneCanvas(input, true);
  }
  if (phase === 1) {
    gl.bindTexture(gl.TEXTURE_2D, bTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
    return cloneCanvas(input, true);
  }

  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, aTex.tex);
    gl.uniform1i(prog.uniforms.u_a, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bTex.tex);
    gl.uniform1i(prog.uniforms.u_b, 1);
    gl.uniform1f(prog.uniforms.u_strength, strength);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("ABA Bounce", "WebGL2", `strength=${strength}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter<AbaBounceOptions>({
  name: "ABA Bounce",
  func: abaBounce,
  optionTypes,
  options: defaults,
  defaults,
  description: "Store A and B, then turn the emphasized beat into a reflected reverse frame whose cadence can drift off the strict ABA grid",
  temporal: true,
  requiresGL: true,
});
