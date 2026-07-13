import { ACTION, ENUM, RANGE } from "constants/controlTypes";
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

const AXIS = { ROWS: "ROWS", COLUMNS: "COLUMNS" };
const DIRECTION = { FORWARD: "FORWARD", REVERSE: "REVERSE" };

export const optionTypes = {
  axis: {
    type: ENUM,
    options: [
      { name: "Row readout", value: AXIS.ROWS },
      { name: "Column readout", value: AXIS.COLUMNS },
    ],
    default: AXIS.ROWS,
    desc: "Sensor scan axis — rows produce classic CMOS bending; columns create a sideways scan",
  },
  direction: {
    type: ENUM,
    options: [
      { name: "Forward", value: DIRECTION.FORWARD },
      { name: "Reverse", value: DIRECTION.REVERSE },
    ],
    default: DIRECTION.FORWARD,
    desc: "Which edge of the sensor is captured first",
  },
  readout: { type: RANGE, range: [0, 1], step: 0.01, default: 0.85, desc: "Fraction of a frame spanned by the sensor readout" },
  skew: { type: RANGE, range: [-64, 64], step: 1, default: 18, desc: "Position shear accumulated across the readout, in pixels" },
  wobble: { type: RANGE, range: [0, 24], step: 0.5, default: 3, desc: "Sinusoidal readout-clock instability in pixels" },
  exposureBlend: { type: RANGE, range: [0, 1], step: 0.01, default: 0.2, desc: "Blend neighboring capture times for a softer electronic shutter" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Preview frame rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  axis: optionTypes.axis.default,
  direction: optionTypes.direction.default,
  readout: optionTypes.readout.default,
  skew: optionTypes.skew.default,
  wobble: optionTypes.wobble.default,
  exposureBlend: optionTypes.exposureBlend.default,
  animSpeed: optionTypes.animSpeed.default,
};

type RollingShutterOptions = FilterOptionValues & {
  axis?: string;
  direction?: string;
  readout?: number;
  skew?: number;
  wobble?: number;
  exposureBlend?: number;
  animSpeed?: number;
  _frameIndex?: number;
  _prevInput?: Uint8ClampedArray | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_previous;
uniform vec2 u_res;
uniform float u_havePrevious;
uniform float u_readout;
uniform float u_skew;
uniform float u_wobble;
uniform float u_exposureBlend;
uniform float u_frame;
uniform int u_axis;
uniform int u_reverse;

vec2 clampUv(vec2 uv) {
  return clamp(uv, vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
}

void main() {
  float scan = u_axis == 0 ? v_uv.y : v_uv.x;
  if (u_reverse == 1) scan = 1.0 - scan;
  float history = u_havePrevious * clamp((1.0 - scan) * u_readout, 0.0, 1.0);
  float wave = sin(scan * 31.4159265 + u_frame * 0.37) * u_wobble;
  float displacement = (scan - 0.5) * u_skew + wave;
  vec2 offset = u_axis == 0
    ? vec2(displacement / u_res.x, 0.0)
    : vec2(0.0, displacement / u_res.y);
  vec2 uv = clampUv(v_uv + offset);
  vec4 current = texture(u_source, uv);
  vec4 previous = texture(u_previous, uv);
  vec4 captured = mix(current, previous, history);
  float softness = u_exposureBlend * history * (1.0 - history) * 4.0;
  vec2 softStep = u_axis == 0 ? vec2(1.0 / u_res.x, 0.0) : vec2(0.0, 1.0 / u_res.y);
  vec4 softened = (texture(u_source, clampUv(uv - softStep)) + current + texture(u_source, clampUv(uv + softStep))) / 3.0;
  fragColor = mix(captured, softened, softness);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_previous", "u_res", "u_havePrevious", "u_readout",
    "u_skew", "u_wobble", "u_exposureBlend", "u_frame", "u_axis", "u_reverse",
  ] as const);
  return _prog;
};

const rollingShutter = (input: any, options: RollingShutterOptions = defaults) => {
  const W = input.width, H = input.height;
  const previous = options._prevInput ?? null;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "rollingShutter:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const previousTex = ensureTexture(gl, "rollingShutter:previous", W, H);
  const havePrevious = !!previous && previous.length === W * H * 4;
  if (havePrevious) {
    gl.bindTexture(gl.TEXTURE_2D, previousTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, previous!);
  }

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, havePrevious ? previousTex.tex : sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_previous, 1);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_havePrevious, havePrevious ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_readout, Number(options.readout ?? defaults.readout));
    gl.uniform1f(prog.uniforms.u_skew, Number(options.skew ?? defaults.skew));
    gl.uniform1f(prog.uniforms.u_wobble, Number(options.wobble ?? defaults.wobble));
    gl.uniform1f(prog.uniforms.u_exposureBlend, Number(options.exposureBlend ?? defaults.exposureBlend));
    gl.uniform1f(prog.uniforms.u_frame, Number(options._frameIndex ?? 0));
    gl.uniform1i(prog.uniforms.u_axis, options.axis === AXIS.COLUMNS ? 1 : 0);
    gl.uniform1i(prog.uniforms.u_reverse, options.direction === DIRECTION.REVERSE ? 1 : 0);
  }, vao);

  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Rolling Shutter", "WebGL2", `${options.axis ?? defaults.axis} skew=${options.skew ?? defaults.skew}`);
  return output;
};

export default defineFilter({
  name: "Rolling Shutter",
  func: rollingShutter,
  optionTypes,
  options: defaults,
  defaults,
  description: "CMOS rolling-shutter readout that bends motion progressively across sensor rows or columns",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 15,
  requiresGL: true,
});
