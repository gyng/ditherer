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

const STYLE = {
  FOUNTAIN_PEN: "FOUNTAIN_PEN",
  BRUSH_INK: "BRUSH_INK",
  MARKER_BLEED: "MARKER_BLEED",
};

export const optionTypes = {
  style: {
    type: ENUM,
    options: [
      { name: "Fountain pen", value: STYLE.FOUNTAIN_PEN },
      { name: "Brush ink", value: STYLE.BRUSH_INK },
      { name: "Marker bleed", value: STYLE.MARKER_BLEED },
    ],
    default: STYLE.FOUNTAIN_PEN,
    desc: "Choose a restrained pen line, richer brush wash, or heavy marker bleed character",
  },
  inkThreshold: { type: RANGE, range: [32, 255], step: 1, default: 176, desc: "Pixels darker than this are treated as freshly inked marks" },
  dryRate: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.05, desc: "How quickly wet marks dry and relax toward the source image" },
  darkenAmount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "How much extra darkness wet ink adds before it dries" },
  edgeShrink: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "How much the wet core recedes as the mark dries" },
  paperBleed: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "How far neighboring wetness blooms into surrounding pixels" },
  paperWarmth: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Warm paper tone that blooms around wet edges as the ink dries" },
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
  style: optionTypes.style.default,
  inkThreshold: optionTypes.inkThreshold.default,
  dryRate: optionTypes.dryRate.default,
  darkenAmount: optionTypes.darkenAmount.default,
  edgeShrink: optionTypes.edgeShrink.default,
  paperBleed: optionTypes.paperBleed.default,
  paperWarmth: optionTypes.paperWarmth.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalInkDryingOptions = FilterOptionValues & {
  style?: string;
  inkThreshold?: number;
  dryRate?: number;
  darkenAmount?: number;
  edgeShrink?: number;
  paperBleed?: number;
  paperWarmth?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const STATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prevState;
uniform float u_inkThreshold; // 0..1
uniform float u_dryRate;
uniform float u_isFirst;

void main() {
  vec3 c = texture(u_source, v_uv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float freshInk = clamp((u_inkThreshold - luma) / max(1.0/255.0, u_inkThreshold), 0.0, 1.0);
  vec4 prev = u_isFirst > 0.5 ? vec4(0.0) : texture(u_prevState, v_uv);
  float retainedWet = prev.r * (1.0 - u_dryRate);
  float retainedPig = prev.g * (1.0 - u_dryRate * 0.45);
  float pigment = max(freshInk, retainedPig);
  float wetness = max(max(freshInk, retainedWet), pigment * 0.7);
  fragColor = vec4(wetness, pigment, 0.0, 1.0);
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prevState;   // sampled in 3x3 for neighbor wetness
uniform sampler2D u_state;       // current frame's state
uniform vec2  u_texel;
uniform float u_darkenAmount;
uniform float u_edgeShrink;
uniform float u_paperBleed;
uniform float u_paperWarmth;
uniform int   u_style; // 0=FOUNTAIN_PEN 1=BRUSH_INK 2=MARKER_BLEED

void main() {
  vec4 c = texture(u_source, v_uv);
  vec2 st = texture(u_state, v_uv).rg;
  float wetness = st.r;
  float pigment = st.g;

  float neighborWet = wetness;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      neighborWet = max(neighborWet, texture(u_prevState, v_uv + vec2(float(dx), float(dy)) * u_texel).r);
    }
  }

  float dryProgress = clamp(1.0 - wetness, 0.0, 1.0);
  float core = max(0.0, pigment * (1.0 - u_edgeShrink * dryProgress));
  float spread = neighborWet * u_paperBleed;
  float coreSubFactor = u_style == 2 ? 0.22 : 0.4;
  float haloMul = u_style == 1 ? 0.72 : 0.55;
  float halo = clamp((spread - core * coreSubFactor) * haloMul *
                     (1.0 + dryProgress * (u_style == 2 ? 0.15 : 0.35)), 0.0, 1.0);
  float wetnessMul = u_style == 1 ? 0.24 : u_style == 2 ? 0.12 : 0.18;
  float inkAmount = clamp(core * u_darkenAmount + wetness * wetnessMul, 0.0, 1.0);
  float paperTint = halo * u_paperWarmth * (0.55 + dryProgress * 0.45);
  float sourceWeight = u_style == 2 ? 0.86 : u_style == 1 ? 0.8 : 0.9;
  vec3 inkTint = u_style == 2 ? vec3(64.0, 52.0, 68.0) :
                 u_style == 1 ? vec3(18.0, 16.0, 24.0) :
                                vec3(10.0, 10.0, 18.0);
  inkTint /= 255.0;
  vec3 src255 = c.rgb;
  vec3 outRgb = src255 * (1.0 - inkAmount * sourceWeight)
              + inkTint * inkAmount
              + vec3(214.0, 188.0, 156.0) / 255.0 * halo
              + vec3(234.0, 219.0, 190.0) / 255.0 * paperTint;
  fragColor = vec4(clamp(outRgb, 0.0, 1.0), c.a);
}
`;

let _stateProg: Program | null = null;
let _renderProg: Program | null = null;

const getStateProg = (gl: WebGL2RenderingContext): Program => {
  if (_stateProg) return _stateProg;
  _stateProg = linkProgram(gl, STATE_FS, [
    "u_source", "u_prevState", "u_inkThreshold", "u_dryRate", "u_isFirst",
  ] as const);
  return _stateProg;
};

const getRenderProg = (gl: WebGL2RenderingContext): Program => {
  if (_renderProg) return _renderProg;
  _renderProg = linkProgram(gl, RENDER_FS, [
    "u_source", "u_prevState", "u_state", "u_texel",
    "u_darkenAmount", "u_edgeShrink", "u_paperBleed", "u_paperWarmth", "u_style",
  ] as const);
  return _renderProg;
};

const styleId = (s: string) => s === "BRUSH_INK" ? 1 : s === "MARKER_BLEED" ? 2 : 0;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const temporalInkDrying = (input: any, options: TemporalInkDryingOptions = defaults) => {
  const style = options.style ?? defaults.style;
  const inkThreshold = Number(options.inkThreshold ?? defaults.inkThreshold);
  const styleDryRate = style === STYLE.BRUSH_INK ? 0.035 : style === STYLE.MARKER_BLEED ? 0.06 : 0.05;
  const styleDarken = style === STYLE.BRUSH_INK ? 0.9 : style === STYLE.MARKER_BLEED ? 0.7 : 0.82;
  const styleEdgeShrink = style === STYLE.BRUSH_INK ? 0.18 : style === STYLE.MARKER_BLEED ? 0.55 : 0.38;
  const stylePaperBleed = style === STYLE.BRUSH_INK ? 0.35 : style === STYLE.MARKER_BLEED ? 0.7 : 0.42;
  const stylePaperWarmth = style === STYLE.BRUSH_INK ? 0.65 : style === STYLE.MARKER_BLEED ? 0.28 : 0.52;
  const dryRate = clamp01(Number(options.dryRate ?? styleDryRate));
  const darkenAmount = clamp01(Number(options.darkenAmount ?? styleDarken));
  const edgeShrink = clamp01(Number(options.edgeShrink ?? styleEdgeShrink));
  const paperBleed = clamp01(Number(options.paperBleed ?? stylePaperBleed));
  const paperWarmth = clamp01(Number(options.paperWarmth ?? stylePaperWarmth));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const stateProg = getStateProg(gl);
  const renderProg = getRenderProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "temporalInkDrying:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const stateA = ensureTexture(gl, "temporalInkDrying:stateA", W, H);
  const stateB = ensureTexture(gl, "temporalInkDrying:stateB", W, H);
  const writeState = frameIndex % 2 === 0 ? stateA : stateB;
  const readState  = frameIndex % 2 === 0 ? stateB : stateA;
  const isFirst = frameIndex === 0;

  drawPass(gl, writeState, W, H, stateProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(stateProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readState.tex);
    gl.uniform1i(stateProg.uniforms.u_prevState, 1);
    gl.uniform1f(stateProg.uniforms.u_inkThreshold, inkThreshold / 255);
    gl.uniform1f(stateProg.uniforms.u_dryRate, dryRate);
    gl.uniform1f(stateProg.uniforms.u_isFirst, isFirst ? 1 : 0);
  }, vao);

  drawPass(gl, null, W, H, renderProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(renderProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readState.tex);
    gl.uniform1i(renderProg.uniforms.u_prevState, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, writeState.tex);
    gl.uniform1i(renderProg.uniforms.u_state, 2);
    gl.uniform2f(renderProg.uniforms.u_texel, 1 / W, 1 / H);
    gl.uniform1f(renderProg.uniforms.u_darkenAmount, darkenAmount);
    gl.uniform1f(renderProg.uniforms.u_edgeShrink, edgeShrink);
    gl.uniform1f(renderProg.uniforms.u_paperBleed, paperBleed);
    gl.uniform1f(renderProg.uniforms.u_paperWarmth, paperWarmth);
    gl.uniform1i(renderProg.uniforms.u_style, styleId(style));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Ink Drying", "WebGL2", `style=${style} dry=${dryRate}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Ink Drying",
  func: temporalInkDrying,
  optionTypes,
  options: defaults,
  defaults,
  description: "Fresh marks dry like fountain pen lines, brush ink washes, or marker bleed depending on the chosen paper-and-ink style",
  temporal: true,
  requiresGL: true,
});
