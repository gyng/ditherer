import { ACTION, BOOL, ENUM, RANGE } from "constants/controlTypes";
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

const SOURCE = {
  EMA: "EMA",
  PREVIOUS_FRAME: "PREVIOUS_FRAME",
};

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "EMA background", value: SOURCE.EMA },
      { name: "Previous frame", value: SOURCE.PREVIOUS_FRAME },
    ],
    default: SOURCE.EMA,
    desc: "Compare against the running background model or just the previous frame",
  },
  depth: { type: RANGE, range: [0.5, 8], step: 0.5, default: 3, desc: "How strongly temporal changes emboss the surface shading" },
  decay: { type: RANGE, range: [0.01, 0.3], step: 0.01, default: 0.08, desc: "How quickly old change history relaxes out of the relief map" },
  lightAngle: { type: RANGE, range: [0, 360], step: 5, default: 45, desc: "Direction of the relighting used for the embossed temporal surface" },
  invert: { type: BOOL, default: false, desc: "Flip raised and recessed motion structure" },
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
  source: optionTypes.source.default,
  depth: optionTypes.depth.default,
  decay: optionTypes.decay.default,
  lightAngle: optionTypes.lightAngle.default,
  invert: optionTypes.invert.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalReliefOptions = FilterOptionValues & {
  source?: string;
  depth?: number;
  decay?: number;
  lightAngle?: number;
  invert?: boolean;
  animSpeed?: number;
  _frameIndex?: number;
  _prevInput?: Uint8ClampedArray | null;
  _ema?: Float32Array | null;
};

// Pass 1: write per-pixel energy = max(currentDiff, prevEnergy * (1 - decay)).
// Energy is packed into the R channel of an 8-bit texture. Two textures are
// used as ping-pong (frameIndex parity) so we can read prev energy and write
// new energy in the same draw.
const ENERGY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_reference;
uniform sampler2D u_prevEnergy;
uniform float u_decayRetain;
uniform float u_haveRef;
uniform float u_havePrev;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  float diff = 0.0;
  if (u_haveRef > 0.5) {
    vec3 ref = texture(u_reference, v_uv).rgb;
    diff = (abs(cur.r - ref.r) + abs(cur.g - ref.g) + abs(cur.b - ref.b)) / 3.0;
  }
  float prev = u_havePrev > 0.5 ? texture(u_prevEnergy, v_uv).r : 0.0;
  float energy = max(diff, prev * u_decayRetain);
  fragColor = vec4(energy, energy, energy, 1.0);
}
`;

// Pass 2: relight the energy field as embossed grayscale.
const RELIEF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_energy;
uniform vec2  u_texel;
uniform vec2  u_lightDir;
uniform float u_depthSign;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  float l = texture(u_energy, v_uv - vec2(u_texel.x, 0.0)).r;
  float r = texture(u_energy, v_uv + vec2(u_texel.x, 0.0)).r;
  float u = texture(u_energy, v_uv - vec2(0.0, u_texel.y)).r;
  float d = texture(u_energy, v_uv + vec2(0.0, u_texel.y)).r;
  float c = texture(u_energy, v_uv).r;

  float gx = r - l;
  float gy = d - u;
  float shade = clamp(0.5 + (gx * u_lightDir.x + gy * u_lightDir.y) * u_depthSign + c * 0.35, 0.0, 1.0);
  float baseLuma = dot(cur, vec3(0.2126, 0.7152, 0.0722));
  float relief = clamp(baseLuma * 0.35 + shade * 0.65, 0.0, 1.0);
  fragColor = vec4(relief, relief, relief, 1.0);
}
`;

let _energyProg: Program | null = null;
let _reliefProg: Program | null = null;
let _emaScratch: Uint8ClampedArray | null = null;

const getEnergyProg = (gl: WebGL2RenderingContext): Program => {
  if (_energyProg) return _energyProg;
  _energyProg = linkProgram(gl, ENERGY_FS, [
    "u_source", "u_reference", "u_prevEnergy",
    "u_decayRetain", "u_haveRef", "u_havePrev",
  ] as const);
  return _energyProg;
};

const getReliefProg = (gl: WebGL2RenderingContext): Program => {
  if (_reliefProg) return _reliefProg;
  _reliefProg = linkProgram(gl, RELIEF_FS, [
    "u_source", "u_energy", "u_texel", "u_lightDir", "u_depthSign",
  ] as const);
  return _reliefProg;
};

const temporalRelief = (input: any, options: TemporalReliefOptions = defaults) => {
  const sourceMode = options.source ?? defaults.source;
  const depth = Number(options.depth ?? defaults.depth);
  const decay = Math.max(0, Math.min(1, Number(options.decay ?? defaults.decay)));
  const lightAngle = Number(options.lightAngle ?? defaults.lightAngle) * Math.PI / 180;
  const invert = Boolean(options.invert ?? defaults.invert);
  const frameIndex = Number(options._frameIndex ?? 0);
  const prevInput = options._prevInput ?? null;
  const ema = options._ema ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const energyProg = getEnergyProg(gl);
  const reliefProg = getReliefProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "temporalRelief:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const refTex = ensureTexture(gl, "temporalRelief:reference", W, H);
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

  const energyA = ensureTexture(gl, "temporalRelief:energyA", W, H);
  const energyB = ensureTexture(gl, "temporalRelief:energyB", W, H);
  const writeEnergy = frameIndex % 2 === 0 ? energyA : energyB;
  const readEnergy  = frameIndex % 2 === 0 ? energyB : energyA;
  const havePrev = frameIndex > 0;

  // Pass 1 — write new energy.
  drawPass(gl, writeEnergy, W, H, energyProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(energyProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, refTex.tex);
    gl.uniform1i(energyProg.uniforms.u_reference, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, readEnergy.tex);
    gl.uniform1i(energyProg.uniforms.u_prevEnergy, 2);
    gl.uniform1f(energyProg.uniforms.u_decayRetain, 1 - decay);
    gl.uniform1f(energyProg.uniforms.u_haveRef, haveRef ? 1 : 0);
    gl.uniform1f(energyProg.uniforms.u_havePrev, havePrev ? 1 : 0);
  }, vao);

  // Pass 2 — relight energy as embossed grayscale to the GL canvas.
  drawPass(gl, null, W, H, reliefProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(reliefProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, writeEnergy.tex);
    gl.uniform1i(reliefProg.uniforms.u_energy, 1);
    gl.uniform2f(reliefProg.uniforms.u_texel, 1 / W, 1 / H);
    gl.uniform2f(reliefProg.uniforms.u_lightDir, Math.cos(lightAngle), Math.sin(lightAngle));
    gl.uniform1f(reliefProg.uniforms.u_depthSign, invert ? -depth : depth);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Motion Relief", "WebGL2", `depth=${depth} decay=${decay}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Motion Relief",
  func: temporalRelief,
  optionTypes,
  options: defaults,
  defaults,
  description: "Convert recent motion history into embossed grayscale surface shading so change reads like raised relief",
  temporal: true,
  requiresGL: true,
});
