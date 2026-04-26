import { ACTION, ENUM, RANGE } from "constants/controlTypes";
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
  uploadSourceTexture,
  type Program,
} from "gl";

const MODE = {
  LIVE_GHOST: "LIVE_GHOST",
  STROBE: "STROBE",
  HOLD_FLASH: "HOLD_FLASH",
} as const;

export const optionTypes = {
  mode: {
    type: ENUM,
    default: MODE.LIVE_GHOST,
    options: [
      { name: "Live ghost", value: MODE.LIVE_GHOST },
      { name: "Strobe", value: MODE.STROBE },
      { name: "Hold flash", value: MODE.HOLD_FLASH },
    ],
    desc: "Flicker model: live ghosting, hard strobe brightness, or held-frame flashing",
  },
  amount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Overall flicker intensity" },
  flash: { type: RANGE, range: [0.5, 2.5], step: 0.05, default: 1.5, desc: "Brightness multiplier on the flashed beat" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  mode: optionTypes.mode.default,
  amount: optionTypes.amount.default,
  flash: optionTypes.flash.default,
  animSpeed: optionTypes.animSpeed.default,
};

type FlickerOptions = FilterOptionValues & {
  mode?: string;
  amount?: number;
  flash?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_held;
uniform float u_amount;
uniform float u_flash;
uniform int   u_mode;   // 0 LIVE_GHOST, 1 STROBE, 2 HOLD_FLASH

void main() {
  vec3 c = texture(u_source, v_uv).rgb;
  vec3 h = texture(u_held, v_uv).rgb;
  vec3 r;
  if (u_mode == 0) {
    r = (h * u_amount + c * (1.0 - u_amount)) * u_flash;
  } else if (u_mode == 1) {
    float pulse = 1.0 + u_amount * (u_flash - 1.0);
    r = c * pulse;
  } else {
    vec3 mix = h * u_amount + c * (1.0 - u_amount * 0.5);
    float pulse = 1.0 + u_amount * (u_flash - 1.0);
    r = mix * pulse;
  }
  fragColor = vec4(clamp(r, 0.0, 1.0), 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, ["u_source", "u_held", "u_amount", "u_flash", "u_mode"] as const);
  return _prog;
};

const modeId = (m: string) => m === MODE.STROBE ? 1 : m === MODE.HOLD_FLASH ? 2 : 0;

const flicker = (input: any, options: FlickerOptions = defaults) => {
  const mode = options.mode || defaults.mode;
  const amount = Math.max(0, Math.min(1, Number(options.amount ?? defaults.amount)));
  const flash = Math.max(0, Number(options.flash ?? defaults.flash));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;
  const phase = ((frameIndex % 3) + 3) % 3;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const heldTex = ensureTexture(gl, "flicker:held", W, H);

  // Phase 0 captures the source as the new "held A" frame and returns
  // input unchanged. Phase 1 returns input unchanged. Phase 2 renders the
  // flicker using held+source.
  if (phase === 0) {
    gl.bindTexture(gl.TEXTURE_2D, heldTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
  }
  if (phase !== 2) {
    return cloneCanvas(input, true);
  }

  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "flicker:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, heldTex.tex);
    gl.uniform1i(prog.uniforms.u_held, 1);
    gl.uniform1f(prog.uniforms.u_amount, amount);
    gl.uniform1f(prog.uniforms.u_flash, flash);
    gl.uniform1i(prog.uniforms.u_mode, modeId(mode));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Flicker", "WebGL2", `mode=${mode} amount=${amount}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Flicker",
  func: flicker,
  optionTypes,
  options: defaults,
  defaults,
  description: "Aggressive projector/monitor flicker with live ghost, strobe, and held-frame flash modes",
  temporal: true,
  requiresGL: true,
});
