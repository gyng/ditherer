import { ACTION, COLOR, ENUM, RANGE } from "constants/controlTypes";
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

const SOURCE = { EMA: "EMA", PREVIOUS_FRAME: "PREVIOUS_FRAME" };
const RENDER = {
  MASK: "MASK", HEATMAP: "HEATMAP", SOURCE: "SOURCE",
  DIFFERENCE: "DIFFERENCE", ACCUMULATED_HEAT: "ACCUMULATED_HEAT",
};
const COLORMAP = { INFERNO: "INFERNO", VIRIDIS: "VIRIDIS", HOT: "HOT" };

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "EMA background", value: SOURCE.EMA },
      { name: "Previous frame", value: SOURCE.PREVIOUS_FRAME },
    ],
    default: SOURCE.EMA,
    desc: "Compare against the running background model or just the immediately previous frame",
  },
  renderMode: {
    type: ENUM,
    options: [
      { name: "Mask", value: RENDER.MASK },
      { name: "Heatmap", value: RENDER.HEATMAP },
      { name: "Source color", value: RENDER.SOURCE },
      { name: "Difference highlight", value: RENDER.DIFFERENCE },
      { name: "Accumulated heat", value: RENDER.ACCUMULATED_HEAT },
    ],
    default: RENDER.MASK,
    desc: "How to visualize detected motion",
  },
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 10, desc: "Minimum pixel change to register as motion" },
  sensitivity: {
    type: RANGE, range: [1, 10], step: 0.5, default: 3,
    desc: "Amplify detected motion intensity",
    visibleWhen: (options: any) => options.renderMode !== RENDER.ACCUMULATED_HEAT,
  },
  backgroundColor: {
    type: COLOR, default: [0, 0, 0],
    desc: "Background color where no motion is detected",
    visibleWhen: (options: any) => options.renderMode !== RENDER.ACCUMULATED_HEAT,
  },
  colorMap: {
    type: ENUM,
    options: [
      { name: "Inferno", value: COLORMAP.INFERNO },
      { name: "Viridis", value: COLORMAP.VIRIDIS },
      { name: "Hot", value: COLORMAP.HOT },
    ],
    default: COLORMAP.INFERNO,
    desc: "Color palette for heat visualization",
    visibleWhen: (options: any) => options.renderMode === RENDER.HEATMAP || options.renderMode === RENDER.ACCUMULATED_HEAT,
  },
  accumRate: {
    type: RANGE, range: [0.01, 0.2], step: 0.01, default: 0.05,
    desc: "How quickly motion builds heat over time",
    visibleWhen: (options: any) => options.renderMode === RENDER.ACCUMULATED_HEAT,
  },
  coolRate: {
    type: RANGE, range: [0.001, 0.05], step: 0.001, default: 0.01,
    desc: "How quickly idle areas cool in accumulated heat mode",
    visibleWhen: (options: any) => options.renderMode === RENDER.ACCUMULATED_HEAT,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  source: optionTypes.source.default,
  renderMode: optionTypes.renderMode.default,
  threshold: optionTypes.threshold.default,
  sensitivity: optionTypes.sensitivity.default,
  backgroundColor: optionTypes.backgroundColor.default,
  colorMap: optionTypes.colorMap.default,
  accumRate: optionTypes.accumRate.default,
  coolRate: optionTypes.coolRate.default,
  animSpeed: optionTypes.animSpeed.default,
};

type MotionDetectOptions = FilterOptionValues & {
  source?: string;
  renderMode?: string;
  threshold?: number;
  sensitivity?: number;
  backgroundColor?: number[];
  colorMap?: string;
  accumRate?: number;
  coolRate?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _prevInput?: Uint8ClampedArray | null;
  _prevOutput?: Uint8ClampedArray | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_reference;
uniform sampler2D u_prevOutput;
uniform vec3  u_bg;
uniform float u_threshold;     // 0..1
uniform float u_sensitivity;
uniform float u_accumRate;
uniform float u_coolRate;
uniform float u_haveRef;
uniform float u_havePrev;
uniform int   u_renderMode;    // 0 MASK, 1 HEATMAP, 2 SOURCE, 3 DIFFERENCE, 4 ACCUM_HEAT
uniform int   u_colorMap;      // 0 INFERNO, 1 VIRIDIS, 2 HOT

vec3 inferno(float t) {
  if (t < 0.25) { float s = t * 4.0; return vec3(s * 100.0, 0.0, s * 150.0) / 255.0; }
  if (t < 0.5)  { float s = (t - 0.25) * 4.0; return vec3(100.0 + s * 155.0, s * 50.0, 150.0 - s * 100.0) / 255.0; }
  if (t < 0.75) { float s = (t - 0.5) * 4.0; return vec3(255.0, 50.0 + s * 150.0, 50.0 - s * 50.0) / 255.0; }
  float s = (t - 0.75) * 4.0;
  return vec3(255.0, 200.0 + s * 55.0, s * 200.0) / 255.0;
}
vec3 viridis(float t) {
  if (t < 0.33) { float s = t * 3.0; return vec3(68.0 - s * 40.0, 1.0 + s * 120.0, 84.0 + s * 80.0) / 255.0; }
  if (t < 0.66) { float s = (t - 0.33) * 3.0; return vec3(28.0 + s * 60.0, 121.0 + s * 70.0, 164.0 - s * 80.0) / 255.0; }
  float s = (t - 0.66) * 3.0;
  return vec3(88.0 + s * 165.0, 191.0 + s * 40.0, 84.0 - s * 40.0) / 255.0;
}
vec3 hot(float t) {
  if (t < 0.33) { float s = t * 3.0; return vec3(s * 255.0, 0.0, 0.0) / 255.0; }
  if (t < 0.66) { float s = (t - 0.33) * 3.0; return vec3(255.0, s * 255.0, 0.0) / 255.0; }
  float s = (t - 0.66) * 3.0;
  return vec3(255.0, 255.0, s * 255.0) / 255.0;
}
vec3 mapHeat(float t, int mode) {
  t = clamp(t, 0.0, 1.0);
  if (mode == 1) return viridis(t);
  if (mode == 2) return hot(t);
  return inferno(t);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 cur = c.rgb;
  if (u_haveRef < 0.5) {
    if (u_renderMode == 4) fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    else fragColor = vec4(cur * 0.3, 1.0);
    return;
  }
  vec3 ref = texture(u_reference, v_uv).rgb;
  float diff = (abs(cur.r - ref.r) + abs(cur.g - ref.g) + abs(cur.b - ref.b)) / 3.0;
  float motion = clamp(((diff - u_threshold) / (80.0/255.0)) * u_sensitivity, 0.0, 1.0);

  if (u_renderMode == 4) {
    float prevHeat = u_havePrev > 0.5 ? texture(u_prevOutput, v_uv).r : 0.0;
    float heat = clamp(prevHeat * (1.0 - u_coolRate) + diff * u_accumRate, 0.0, 1.0);
    fragColor = vec4(mapHeat(heat, u_colorMap), 1.0);
    return;
  }

  if (diff < u_threshold) {
    fragColor = vec4(u_bg, 1.0);
    return;
  }

  if (u_renderMode == 0) {
    fragColor = vec4(vec3(motion), 1.0);
  } else if (u_renderMode == 1) {
    fragColor = vec4(mapHeat(motion, u_colorMap), 1.0);
  } else if (u_renderMode == 2) {
    fragColor = vec4(cur, 1.0);
  } else {
    float v = clamp(64.0/255.0 + diff * 3.0, 0.0, 1.0);
    fragColor = vec4(vec3(v), 1.0);
  }
}
`;

let _prog: Program | null = null;
let _emaScratch: Uint8ClampedArray | null = null;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_reference", "u_prevOutput", "u_bg",
    "u_threshold", "u_sensitivity", "u_accumRate", "u_coolRate",
    "u_haveRef", "u_havePrev", "u_renderMode", "u_colorMap",
  ] as const);
  return _prog;
};

const renderModeId = (m: string) =>
  m === RENDER.HEATMAP ? 1 : m === RENDER.SOURCE ? 2 : m === RENDER.DIFFERENCE ? 3 : m === RENDER.ACCUMULATED_HEAT ? 4 : 0;
const colorMapId = (m: string) => m === COLORMAP.VIRIDIS ? 1 : m === COLORMAP.HOT ? 2 : 0;

const motionAnalysis = (input: any, options: MotionDetectOptions = defaults) => {
  const sourceMode = String(options.source ?? defaults.source);
  const renderMode = String(options.renderMode ?? defaults.renderMode);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const sensitivity = Number(options.sensitivity ?? defaults.sensitivity);
  const bg = Array.isArray(options.backgroundColor) ? options.backgroundColor : defaults.backgroundColor;
  const colorMap = String(options.colorMap ?? defaults.colorMap);
  const accumRate = Number(options.accumRate ?? defaults.accumRate);
  const coolRate = Number(options.coolRate ?? defaults.coolRate);
  const ema = options._ema ?? null;
  const prevInput = options._prevInput ?? null;
  const prevOutput = options._prevOutput ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "motionDetect:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const refTex = ensureTexture(gl, "motionDetect:reference", W, H);
  let haveRef = false;
  if (sourceMode === SOURCE.PREVIOUS_FRAME && prevInput && prevInput.length === W * H * 4) {
    gl.bindTexture(gl.TEXTURE_2D, refTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prevInput);
    haveRef = true;
  } else if (sourceMode === SOURCE.EMA && ema && ema.length === W * H * 4) {
    if (!_emaScratch || _emaScratch.length !== ema.length) {
      _emaScratch = new Uint8ClampedArray(ema.length);
    }
    for (let i = 0; i < ema.length; i++) _emaScratch[i] = ema[i];
    gl.bindTexture(gl.TEXTURE_2D, refTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, _emaScratch);
    haveRef = true;
  }

  const prevOutTex = ensureTexture(gl, "motionDetect:prevOutput", W, H);
  const havePrev = !!prevOutput && prevOutput.length === W * H * 4;
  if (havePrev) {
    gl.bindTexture(gl.TEXTURE_2D, prevOutTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prevOutput!);
  }

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, refTex.tex);
    gl.uniform1i(prog.uniforms.u_reference, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, prevOutTex.tex);
    gl.uniform1i(prog.uniforms.u_prevOutput, 2);
    gl.uniform3f(prog.uniforms.u_bg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    gl.uniform1f(prog.uniforms.u_threshold, threshold / 255);
    gl.uniform1f(prog.uniforms.u_sensitivity, sensitivity);
    gl.uniform1f(prog.uniforms.u_accumRate, accumRate);
    gl.uniform1f(prog.uniforms.u_coolRate, coolRate);
    gl.uniform1f(prog.uniforms.u_haveRef, haveRef ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_havePrev, havePrev ? 1 : 0);
    gl.uniform1i(prog.uniforms.u_renderMode, renderModeId(renderMode));
    gl.uniform1i(prog.uniforms.u_colorMap, colorMapId(colorMap));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Motion Analysis", "WebGL2", `mode=${renderMode} thr=${threshold}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Motion Analysis",
  func: motionAnalysis,
  optionTypes,
  options: defaults,
  defaults,
  description: "Analyze motion against the background model or previous frame and render it as a mask, highlight, or persistent heatmap",
  temporal: true,
  requiresGL: true,
});
