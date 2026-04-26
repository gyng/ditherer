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

const MODE = {
  BLEND: "BLEND",
  SHUTTER: "SHUTTER",
  MAX: "MAX",
  ADDITIVE: "ADDITIVE",
  RUNNING_AVERAGE: "RUNNING_AVERAGE",
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Blend", value: MODE.BLEND },
      { name: "Shutter average", value: MODE.SHUTTER },
      { name: "Long exposure max", value: MODE.MAX },
      { name: "Long exposure additive", value: MODE.ADDITIVE },
      { name: "Running average", value: MODE.RUNNING_AVERAGE },
    ],
    default: MODE.BLEND,
    desc: "Choose between soft ghosting, slow-shutter averaging, or brighter long-exposure accumulation",
  },
  blendFactor: {
    type: RANGE, range: [0.1, 0.95], step: 0.05, default: 0.7,
    desc: "Weight of the previous frame in blend mode",
    visibleWhen: (options: LongExposureOptions) => options.mode === MODE.BLEND,
  },
  windowSize: {
    type: RANGE, range: [2, 30], step: 1, default: 8,
    desc: "How many recent frames get averaged in shutter mode",
    visibleWhen: (options: LongExposureOptions) => options.mode === MODE.SHUTTER,
  },
  decay: {
    type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.05,
    desc: "How fast old light fades in accumulation modes",
    visibleWhen: (options: LongExposureOptions) => options.mode !== MODE.SHUTTER,
  },
  brightnessThreshold: {
    type: RANGE, range: [0, 255], step: 5, default: 30,
    desc: "Only accumulate pixels brighter than this in long-exposure modes",
    visibleWhen: (options: LongExposureOptions) => options.mode === MODE.MAX || options.mode === MODE.ADDITIVE,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  mode: optionTypes.mode.default,
  blendFactor: optionTypes.blendFactor.default,
  windowSize: optionTypes.windowSize.default,
  decay: optionTypes.decay.default,
  brightnessThreshold: optionTypes.brightnessThreshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

type LongExposureOptions = FilterOptionValues & {
  mode?: string;
  blendFactor?: number;
  windowSize?: number;
  decay?: number;
  brightnessThreshold?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
};

const MAX_SHUTTER = 30;

const SHUTTER_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_frames;
uniform int u_filled;

void main() {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_SHUTTER}; i++) {
    if (i >= u_filled) break;
    acc += texture(u_frames, vec3(v_uv, float(i))).rgb;
  }
  fragColor = vec4(acc / float(u_filled), 1.0);
}
`;

const ACCUM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prev;
uniform float u_havePrev;
uniform int   u_mode;          // 0 BLEND, 1 MAX, 2 ADDITIVE, 3 RUNNING_AVERAGE
uniform float u_blendFactor;
uniform float u_decay;
uniform float u_brightThresh;  // 0..1

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  if (u_havePrev < 0.5) {
    fragColor = vec4(cur, 1.0);
    return;
  }
  vec3 prev = texture(u_prev, v_uv).rgb;
  float retain = 1.0 - u_decay;

  if (u_mode == 0) {
    fragColor = vec4(prev * u_blendFactor + cur * (1.0 - u_blendFactor), 1.0);
    return;
  }
  if (u_mode == 1 || u_mode == 2) {
    float lum = (cur.r + cur.g + cur.b) / 3.0;
    bool above = lum >= u_brightThresh;
    if (u_mode == 1) {
      vec3 dec = prev * retain;
      fragColor = vec4(above ? max(cur, dec) : dec, 1.0);
    } else {
      float add = above ? 0.3 : 0.0;
      fragColor = vec4(clamp(prev * retain + cur * add, 0.0, 1.0), 1.0);
    }
    return;
  }
  // RUNNING_AVERAGE
  fragColor = vec4(prev * retain + cur * u_decay, 1.0);
}
`;

let _shutterProg: Program | null = null;
let _accumProg: Program | null = null;
let _shutterHead = 0;
let _shutterFilled = 0;
let _shutterW = 0;
let _shutterH = 0;
let _shutterWindow = 0;

const getShutterProg = (gl: WebGL2RenderingContext): Program => {
  if (_shutterProg) return _shutterProg;
  _shutterProg = linkProgram(gl, SHUTTER_FS, ["u_frames", "u_filled"] as const);
  return _shutterProg;
};

const getAccumProg = (gl: WebGL2RenderingContext): Program => {
  if (_accumProg) return _accumProg;
  _accumProg = linkProgram(gl, ACCUM_FS, [
    "u_source", "u_prev", "u_havePrev", "u_mode",
    "u_blendFactor", "u_decay", "u_brightThresh",
  ] as const);
  return _accumProg;
};

let _shutterArrayTex: WebGLTexture | null = null;

const ensureShutterArray = (gl: WebGL2RenderingContext, w: number, h: number) => {
  if (_shutterArrayTex && _shutterW === w && _shutterH === h) return _shutterArrayTex;
  if (_shutterArrayTex) gl.deleteTexture(_shutterArrayTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, MAX_SHUTTER, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  _shutterArrayTex = tex;
  return tex;
};

const modeId = (m: string) =>
  m === MODE.MAX ? 1 : m === MODE.ADDITIVE ? 2 : m === MODE.RUNNING_AVERAGE ? 3 : 0;

const longExposure = (input: any, options: LongExposureOptions = defaults) => {
  const mode = String(options.mode ?? defaults.mode);
  const blendFactor = Number(options.blendFactor ?? defaults.blendFactor);
  const windowSize = Math.max(2, Math.min(MAX_SHUTTER, Math.round(Number(options.windowSize ?? defaults.windowSize))));
  const decay = Number(options.decay ?? defaults.decay);
  const brightnessThreshold = Number(options.brightnessThreshold ?? defaults.brightnessThreshold);
  const prev = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "longExposure:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  if (mode === MODE.SHUTTER) {
    const prog = getShutterProg(gl);
    const arrTex = ensureShutterArray(gl, W, H);
    if (!arrTex) return glUnavailableStub(W, H);

    if (_shutterW !== W || _shutterH !== H || _shutterWindow !== windowSize || frameIndex === 0) {
      _shutterW = W; _shutterH = H; _shutterWindow = windowSize;
      _shutterHead = 0; _shutterFilled = 0;
    }

    const layer = _shutterHead % windowSize;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, W, H, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
    _shutterHead++;
    _shutterFilled = Math.min(_shutterFilled + 1, windowSize);

    drawPass(gl, null, W, H, prog, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
      gl.uniform1i(prog.uniforms.u_frames, 0);
      gl.uniform1i(prog.uniforms.u_filled, _shutterFilled);
    }, vao);
  } else {
    const prog = getAccumProg(gl);
    const prevTex = ensureTexture(gl, "longExposure:prev", W, H);
    const havePrev = !!prev && prev.length === W * H * 4;
    if (havePrev) {
      gl.bindTexture(gl.TEXTURE_2D, prevTex.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prev!);
    }

    drawPass(gl, null, W, H, prog, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevTex.tex);
      gl.uniform1i(prog.uniforms.u_prev, 1);
      gl.uniform1f(prog.uniforms.u_havePrev, havePrev ? 1 : 0);
      gl.uniform1i(prog.uniforms.u_mode, modeId(mode));
      gl.uniform1f(prog.uniforms.u_blendFactor, blendFactor);
      gl.uniform1f(prog.uniforms.u_decay, decay);
      gl.uniform1f(prog.uniforms.u_brightThresh, brightnessThreshold / 255);
    }, vao);
  }

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Long Exposure", "WebGL2", `mode=${mode}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Long Exposure",
  func: longExposure,
  optionTypes,
  options: defaults,
  defaults,
  description: "Blend, average, or accumulate recent frames for ghost trails, slow-shutter smear, and long-exposure light painting",
  temporal: true,
  requiresGL: true,
});
