import { RANGE, ACTION } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import { normalizeRangeOption } from "../utils/filterOptions";
import { TURBULENCE_GLSL } from "./turbulenceField";
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
} from "../gl/index";

export const optionTypes = {
  intensity: { type: RANGE, range: [1, 20], step: 1, default: 8, desc: "Max pixel displacement" },
  turbulence: { type: RANGE, range: [1, 5], step: 0.5, default: 2, desc: "Noise frequency in the warp pattern" },
  settleSpeed: { type: RANGE, range: [0.02, 0.2], step: 0.01, default: 0.08, desc: "How fast distortion fades after motion stops" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  turbulence: optionTypes.turbulence.default,
  settleSpeed: optionTypes.settleSpeed.default,
  animSpeed: optionTypes.animSpeed.default,
};

type WakeTurbulenceOptions = FilterOptionValues & {
  intensity?: number;
  turbulence?: number;
  settleSpeed?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _frameIndex?: number;
};

// Pass 1: update per-pixel motion energy. Energy lives in R channel of an
// RGBA8 ping-pong texture.
const ENERGY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_ema;
uniform sampler2D u_prevEnergy;
uniform float u_settle;
uniform float u_haveEma;
uniform float u_havePrev;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  float motion = 0.0;
  if (u_haveEma > 0.5) {
    vec3 ema = texture(u_ema, v_uv).rgb;
    motion = (abs(cur.r - ema.r) + abs(cur.g - ema.g) + abs(cur.b - ema.b)) / 3.0;
  }
  float prev = u_havePrev > 0.5 ? texture(u_prevEnergy, v_uv).r : 0.0;
  float energy = clamp(prev * (1.0 - u_settle) + motion * 0.5, 0.0, 1.0);
  fragColor = vec4(energy, 0.0, 0.0, 1.0);
}
`;

// Pass 2: refract the source by a DIVERGENCE-FREE curl-noise turbulence field
// (real incompressible turbulence), gated by the motion energy and advected
// downstream along the motion-energy gradient so the ripples trail moving
// objects — instead of a stationary axis-aligned sinusoid.
const WARP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_energy;
uniform vec2  u_resolution;
uniform vec2  u_texel;
uniform float u_intensity;
uniform float u_turbulence;
uniform float u_t;

${TURBULENCE_GLSL}

void main() {
  vec2 px = v_uv * u_resolution;
  float e = texture(u_energy, v_uv).r;

  // Local flow direction from the motion-energy gradient; the wake trails along
  // it (downstream), so advect the noise field in that direction over time.
  float eR = texture(u_energy, v_uv + vec2(u_texel.x, 0.0)).r;
  float eL = texture(u_energy, v_uv - vec2(u_texel.x, 0.0)).r;
  float eU = texture(u_energy, v_uv + vec2(0.0, u_texel.y)).r;
  float eD = texture(u_energy, v_uv - vec2(0.0, u_texel.y)).r;
  vec2 grad = vec2(eR - eL, eU - eD);
  vec2 flow = length(grad) > 1e-4 ? normalize(grad) : vec2(0.0);

  vec2 np = px * (u_turbulence * 0.03) - flow * u_t * 2.0 + vec2(0.0, u_t * 0.15);
  vec2 disp = e * u_intensity * tf_curlNoise(np, 1.0);
  vec2 sampleUv = clamp(v_uv + disp * u_texel, vec2(0.0), vec2(1.0));
  fragColor = texture(u_source, sampleUv);
}
`;

let _energyProg: Program | null = null;
let _warpProg: Program | null = null;
let _emaScratch: Uint8ClampedArray | null = null;

const getEnergyProg = (gl: WebGL2RenderingContext): Program => {
  if (_energyProg) return _energyProg;
  _energyProg = linkProgram(gl, ENERGY_FS, [
    "u_source", "u_ema", "u_prevEnergy", "u_settle", "u_haveEma", "u_havePrev",
  ] as const);
  return _energyProg;
};

const getWarpProg = (gl: WebGL2RenderingContext): Program => {
  if (_warpProg) return _warpProg;
  _warpProg = linkProgram(gl, WARP_FS, [
    "u_source", "u_energy", "u_resolution", "u_texel", "u_intensity", "u_turbulence", "u_t",
  ] as const);
  return _warpProg;
};

const wakeTurbulence = (input: any, options: WakeTurbulenceOptions = defaults) => {
  const intensity = normalizeRangeOption(options.intensity, defaults.intensity, 1, 20);
  const turbulence = normalizeRangeOption(options.turbulence, defaults.turbulence, 1, 5);
  const settleSpeed = normalizeRangeOption(options.settleSpeed, defaults.settleSpeed, 0.02, 0.2);
  const ema = options._ema ?? null;
  const frameIndex = normalizeRangeOption(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER, true);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const energyProg = getEnergyProg(gl);
  const warpProg = getWarpProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "wakeTurbulence:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const emaTex = ensureTexture(gl, "wakeTurbulence:ema", W, H);
  let haveEma = false;
  if (ema && ema.length === W * H * 4) {
    if (!_emaScratch || _emaScratch.length !== ema.length) {
      _emaScratch = new Uint8ClampedArray(ema.length);
    }
    for (let i = 0; i < ema.length; i++) _emaScratch[i] = ema[i];
    gl.bindTexture(gl.TEXTURE_2D, emaTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, _emaScratch);
    haveEma = true;
  }

  const energyA = ensureTexture(gl, "wakeTurbulence:energyA", W, H);
  const energyB = ensureTexture(gl, "wakeTurbulence:energyB", W, H);
  const writeEnergy = frameIndex % 2 === 0 ? energyA : energyB;
  const readEnergy  = frameIndex % 2 === 0 ? energyB : energyA;
  const havePrev = frameIndex > 0;

  drawPass(gl, writeEnergy, W, H, energyProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(energyProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, emaTex.tex);
    gl.uniform1i(energyProg.uniforms.u_ema, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, readEnergy.tex);
    gl.uniform1i(energyProg.uniforms.u_prevEnergy, 2);
    gl.uniform1f(energyProg.uniforms.u_settle, settleSpeed);
    gl.uniform1f(energyProg.uniforms.u_haveEma, haveEma ? 1 : 0);
    gl.uniform1f(energyProg.uniforms.u_havePrev, havePrev ? 1 : 0);
  }, vao);

  drawPass(gl, null, W, H, warpProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(warpProg.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, writeEnergy.tex);
    gl.uniform1i(warpProg.uniforms.u_energy, 1);
    gl.uniform2f(warpProg.uniforms.u_resolution, W, H);
    gl.uniform2f(warpProg.uniforms.u_texel, 1 / W, 1 / H);
    gl.uniform1f(warpProg.uniforms.u_intensity, intensity);
    gl.uniform1f(warpProg.uniforms.u_turbulence, turbulence);
    gl.uniform1f(warpProg.uniforms.u_t, frameIndex * 0.15);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Wake Turbulence", "WebGL2", `int=${intensity} turb=${turbulence}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Wake Turbulence",
  func: wakeTurbulence,
  optionTypes,
  options: defaults,
  defaults,
  description: "Moving objects leave rippling distortion in their wake — heat shimmer effect",
  temporal: true,
  requiresGL: true,
});
