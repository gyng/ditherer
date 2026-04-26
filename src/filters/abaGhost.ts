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
  ghostMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.95, desc: "How strongly the stored B frame dominates the returned A beat so the ghost image stays obvious instead of reading like pure stutter" },
  persistence: { type: RANGE, range: [0, 0.99], step: 0.01, default: 0.85, desc: "How long the ghost image lingers across later beats and triplets" },
  flash: { type: RANGE, range: [0, 1.8], step: 0.05, default: 0.15, desc: "Brightness lift applied to the ghosted beat; lower values keep the persistent double exposure dominant" },
  cadenceDrift: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "How much the emphasized ghost beat wanders between strict ABA timing and a looser variable-frame cadence" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  }},
};

export const defaults = {
  ghostMix: optionTypes.ghostMix.default,
  persistence: optionTypes.persistence.default,
  flash: optionTypes.flash.default,
  cadenceDrift: optionTypes.cadenceDrift.default,
  animSpeed: optionTypes.animSpeed.default,
};

type AbaGhostOptions = FilterOptionValues & typeof defaults & {
  _frameIndex?: number;
};

// Pass 1: update ghost accumulator. Pass 2: blend source with ghost.
const GHOST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform sampler2D u_prevGhost;
uniform float u_ghostMix;
uniform float u_persistence;
uniform float u_flash;
uniform float u_ghostWrite;

void main() {
  vec3 a = texture(u_a, v_uv).rgb;
  vec3 b = texture(u_b, v_uv).rgb;
  vec3 inj = (a * (1.0 - u_ghostMix) + b * u_ghostMix) * u_flash;
  vec3 prev = texture(u_prevGhost, v_uv).rgb;
  // The accumulator can exceed 1.0 mathematically; clamp on store so we
  // can keep using RGBA8.
  fragColor = vec4(clamp(prev * u_persistence + inj * u_ghostWrite, 0.0, 1.0), 1.0);
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_ghost;
uniform float u_carry;

void main() {
  vec3 c = texture(u_source, v_uv).rgb;
  vec3 g = texture(u_ghost, v_uv).rgb;
  fragColor = vec4(clamp(c * (1.0 - u_carry) + g * u_carry, 0.0, 1.0), 1.0);
}
`;

let _ghostProg: Program | null = null;
let _renderProg: Program | null = null;

const getGhostProg = (gl: WebGL2RenderingContext): Program => {
  if (_ghostProg) return _ghostProg;
  _ghostProg = linkProgram(gl, GHOST_FS, [
    "u_a", "u_b", "u_prevGhost",
    "u_ghostMix", "u_persistence", "u_flash", "u_ghostWrite",
  ] as const);
  return _ghostProg;
};

const getRenderProg = (gl: WebGL2RenderingContext): Program => {
  if (_renderProg) return _renderProg;
  _renderProg = linkProgram(gl, RENDER_FS, ["u_source", "u_ghost", "u_carry"] as const);
  return _renderProg;
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

const abaGhost = (input: any, options: AbaGhostOptions = defaults) => {
  const ghostMix = Math.max(0, Math.min(1, Number(options.ghostMix ?? defaults.ghostMix)));
  const persistence = Math.max(0, Math.min(0.999, Number(options.persistence ?? defaults.persistence)));
  const flash = Math.max(0, Number(options.flash ?? defaults.flash));
  const cadenceDrift = Math.max(0, Math.min(1, Number(options.cadenceDrift ?? defaults.cadenceDrift)));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const aTex = ensureTexture(gl, "abaGhost:A", W, H);
  const bTex = ensureTexture(gl, "abaGhost:B", W, H);
  const ghostA = ensureTexture(gl, "abaGhost:ghostA", W, H);
  const ghostB = ensureTexture(gl, "abaGhost:ghostB", W, H);
  const phase = computeEffectivePhase(frameIndex, cadenceDrift);

  // Capture A on phase 0, B on phase 1 (as in JS).
  if (phase === 0) {
    gl.bindTexture(gl.TEXTURE_2D, aTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
  } else if (phase === 1) {
    gl.bindTexture(gl.TEXTURE_2D, bTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
  }

  const ghostProg = getGhostProg(gl);
  const renderProg = getRenderProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "abaGhost:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  // Ping-pong ghost on frame parity.
  const writeGhost = frameIndex % 2 === 0 ? ghostA : ghostB;
  const readGhost  = frameIndex % 2 === 0 ? ghostB : ghostA;
  const ghostWrite = phase === 2 ? 1 : 0.18;
  const carry = phase === 2 ? 1 : Math.min(0.65, persistence * 0.55);

  drawPass(gl, writeGhost, W, H, ghostProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, aTex.tex);
    gl.uniform1i(ghostProg.uniforms.u_a, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bTex.tex);
    gl.uniform1i(ghostProg.uniforms.u_b, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, readGhost.tex);
    gl.uniform1i(ghostProg.uniforms.u_prevGhost, 2);
    gl.uniform1f(ghostProg.uniforms.u_ghostMix, ghostMix);
    gl.uniform1f(ghostProg.uniforms.u_persistence, persistence);
    gl.uniform1f(ghostProg.uniforms.u_flash, flash);
    gl.uniform1f(ghostProg.uniforms.u_ghostWrite, ghostWrite);
  }, vao);

  drawPass(gl, null, W, H, renderProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(renderProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, writeGhost.tex);
    gl.uniform1i(renderProg.uniforms.u_ghost, 1);
    gl.uniform1f(renderProg.uniforms.u_carry, carry);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("ABA Ghost", "WebGL2", `mix=${ghostMix}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter<AbaGhostOptions>({
  name: "ABA Ghost",
  func: abaGhost,
  optionTypes,
  options: defaults,
  defaults,
  description: "Store A and B, then replay a persistent mostly-B double exposure whose emphasized beat can drift off the strict ABA grid for a looser variable-frame ghost trail",
  temporal: true,
  requiresGL: true,
});
