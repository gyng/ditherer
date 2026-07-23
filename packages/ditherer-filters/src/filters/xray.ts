import { COLOR, ENUM, RANGE } from "../constants/controlTypes";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import {
  normalizeColorOption,
  normalizeEnumOption,
  normalizeRangeOption,
} from "../utils/filterOptions";
import { SRGB_GLSL, sigmaForRadius } from "./opticalConvolutionContracts";
import {
  drawPass,
  ensureFloatTexture,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
  type TexEntry,
} from "../gl/index";

// ---------------------------------------------------------------------------
// X-Ray / Radiograph
//
// HONEST FRAMING: a photograph carries no radiodensity information whatsoever.
// This filter uses the source image's LINEAR LUMINANCE as a stand-in for the
// path-integrated density ∫μ dl that a real beam would accumulate through the
// subject. Everything downstream of that substitution is the genuine physics —
// Beer–Lambert transmission, a Compton-scatter veiling pedestal, and
// dose-dependent quantum mottle — but the input to it is a proxy, not a
// measurement. Nothing here is a radiograph of anything.
//
// Physics implemented:
//  * Beer–Lambert: I = I₀·exp(−μ·t), so transmission T = exp(−k·d) where d is
//    the per-pixel density proxy and k the exposed attenuation control (μ·t).
//  * Display convention: film records TRANSMITTED intensity, so dense material
//    (bone) exposes less film and reads WHITE on a lightbox. POSITIVE shows
//    1−T; NEGATIVE shows the raw film density T.
//  * Compton scatter / veiling glare: scattered photons arrive as a broad
//    low-frequency pedestal that lowers subject contrast — modelled as a
//    separable-Gaussian blur of the transmission image mixed under the primary.
//  * Quantum mottle: photon arrival is Poisson. With N ~ Poisson(λ), λ = dose·T,
//    the transmission estimate is T̂ = N/dose, so Var(T̂) = λ/dose² = T/dose and
//    the ABSOLUTE noise is σ = √(T/dose) — largest where transmission is high.
//    What degrades in dense regions is the SIGNAL-TO-NOISE RATIO: the relative
//    noise σ/T = 1/√(dose·T) = 1/√N rises as fewer photons get through, which
//    is why dense material looks the mottliest even though its absolute σ is
//    small.
//
// Attenuation is a linear-light process, so the source is linearized before the
// exponential and re-encoded with oc_linearToSrgb at output.
// ---------------------------------------------------------------------------

const DENSITY_SOURCE = { LUMA: "LUMA", INVERSE_LUMA: "INVERSE_LUMA" };
const DISPLAY = { POSITIVE: "POSITIVE", NEGATIVE: "NEGATIVE" };

const MAX_SCATTER_RADIUS = 40;
// The scatter blur takes sigma = sigmaForRadius(scatterRadius) = r/3, so its 3σ
// support is exactly r pixels: one tap bound of MAX_SCATTER_RADIUS covers the
// whole slider faithfully at every setting. (Mapping sigma to 2r/3 instead
// would need 80 taps, doubling the statically-unrollable loop at every radius
// to buy width only at the top of the range.)
const MAX_SCATTER_TAPS = MAX_SCATTER_RADIUS;

/** Floor on dose, so the mottle expression stays finite for degenerate inputs. */
const MIN_DOSE_QUANTA = 1e-6;

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

/** Non-finite or non-positive dose is meaningless; fall back to unit fluence. */
const positiveDose = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 1;

/**
 * Beer–Lambert law: I = I₀·exp(−μ·t). Transmission through a path of
 * integrated density `density` given attenuation coefficient `attenuation`
 * (μ·t per unit density). Exactly 1 at zero density and monotonically
 * decreasing in density; never negative.
 */
export const beerLambertTransmission = (
  density: number,
  attenuation: number,
): number => Math.exp(-Math.max(0, finite(attenuation)) * Math.max(0, finite(density)));

/**
 * ABSOLUTE standard deviation of quantum mottle on the transmission estimate.
 * A detector element receives N ~ Poisson(λ) quanta with λ = dose·T, and the
 * transmission estimate is T̂ = N/dose, so Var(T̂) = λ/dose² = T/dose and
 * σ = √(T/dose). Absolute noise is therefore *largest* where transmission is
 * high; it is the relative noise σ/T = 1/√(dose·T) = 1/√N that blows up in
 * dense, photon-starved regions, which is what makes them look mottled.
 *
 * No floor on transmission: √(T/dose) is already finite and exactly zero at
 * T = 0, where a fully-opaque pixel receives no photons and so has no mottle.
 * Guards here only reject meaningless inputs; the GLSL twin is
 * MOTTLE_AMPLITUDE_GLSL below, whose uniforms are pre-normalised.
 */
export const quantumMottleAmplitude = (
  transmission: number,
  dose: number,
  gain: number,
): number => Math.max(0, finite(gain)) * Math.sqrt(
  Math.max(0, finite(transmission)) / Math.max(MIN_DOSE_QUANTA, positiveDose(dose)),
);

/**
 * The mottle amplitude as GLSL, kept as one string so the shader and
 * quantumMottleAmplitude() cannot drift apart unnoticed (a unit test pins this
 * expression, the interpolated constant, and its presence in the shader).
 * `u_dose` is normalised to the option range before upload, so the max() here
 * only mirrors the kernel's degenerate-input guard.
 */
export const MOTTLE_AMPLITUDE_GLSL =
  `max(0.0, u_mottle) * sqrt(max(0.0, transmission) / max(${MIN_DOSE_QUANTA}, u_dose))`;

/**
 * Veiling glare: the detector sees primary transmission plus a broad scattered
 * pedestal. Mixing the two lowers subject contrast without changing the mean.
 */
export const veilingGlareMix = (
  primary: number,
  scattered: number,
  scatterFraction: number,
): number => {
  const s = Math.max(0, Math.min(1, finite(scatterFraction)));
  return finite(primary) * (1 - s) + finite(scattered) * s;
};

/**
 * Display mapping. Film records transmitted intensity, so on a lightbox dense
 * material reads white: the POSITIVE (bone-white) view shows 1−T, while the
 * film-negative view shows T itself.
 */
export const radiographDisplayIntensity = (
  transmission: number,
  positive: boolean,
): number => {
  const t = Math.max(0, Math.min(1, finite(transmission)));
  return positive ? 1 - t : t;
};

export const optionTypes = {
  densitySource: {
    type: ENUM,
    options: [
      { name: "Bright is dense", value: DENSITY_SOURCE.LUMA },
      { name: "Dark is dense", value: DENSITY_SOURCE.INVERSE_LUMA },
    ],
    default: DENSITY_SOURCE.LUMA,
    desc: "Which end of the luminance range stands in for path-integrated density",
  },
  attenuation: { type: RANGE, range: [0, 8], step: 0.05, default: 2.6, desc: "Attenuation coefficient × thickness (μ·t) driving the Beer–Lambert exponential" },
  display: {
    type: ENUM,
    options: [
      { name: "Positive (bone white)", value: DISPLAY.POSITIVE },
      { name: "Film negative", value: DISPLAY.NEGATIVE },
    ],
    default: DISPLAY.POSITIVE,
    desc: "Lightbox positive showing 1−T, or the raw transmitted-intensity negative",
  },
  scatter: { type: RANGE, range: [0, 1], step: 0.01, default: 0.28, desc: "Fraction of the detected signal arriving as Compton-scattered veiling glare" },
  scatterRadius: { type: RANGE, range: [1, MAX_SCATTER_RADIUS], step: 1, default: 32, desc: "Spread of the scattered-radiation pedestal, in pixels" },
  dose: { type: RANGE, range: [4, 400], step: 1, default: 80, desc: "Relative photon fluence; higher dose means less quantum mottle" },
  mottle: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Gain on the Poisson photon noise: the grain is coarsest in the open beam, while dense regions lose signal-to-noise" },
  tint: { type: COLOR, default: [186, 208, 255], desc: "Cool viewing-box cast applied to the developed image" },
  tintStrength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "How strongly the viewing-box tint colours the result" },
};

export const defaults = {
  densitySource: optionTypes.densitySource.default,
  attenuation: optionTypes.attenuation.default,
  display: optionTypes.display.default,
  scatter: optionTypes.scatter.default,
  scatterRadius: optionTypes.scatterRadius.default,
  dose: optionTypes.dose.default,
  mottle: optionTypes.mottle.default,
  tint: optionTypes.tint.default,
  tintStrength: optionTypes.tintStrength.default,
};

// Pass 1 — Beer–Lambert attenuation. The source is linearized first because
// attenuation acts on radiant power, not on gamma-encoded code values.
const XRAY_ATTENUATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_attenuation;
uniform int u_densitySource;
${SRGB_GLSL}
void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 lin = oc_srgbToLinear(src.rgb);
  float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  // Proxy only: luminance stands in for the path integral of the linear
  // attenuation coefficient. There is no radiodensity data in a photograph.
  float density = u_densitySource == 1 ? 1.0 - luma : luma;
  // I = I0 * exp(-mu * t)
  float transmission = exp(-max(0.0, u_attenuation) * max(0.0, density));
  fragColor = vec4(vec3(transmission), src.a);
}
`;

// Pass 2 — separable Gaussian, run once per axis, to form the broad
// low-frequency scatter pedestal (mirrors the blur pass in bloom.ts).
const XRAY_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2 u_res;
uniform vec2 u_axis;
uniform int u_radius;
uniform float u_sigma;
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float inv2s2 = 1.0 / (2.0 * u_sigma * u_sigma);
  for (int k = -${MAX_SCATTER_TAPS}; k <= ${MAX_SCATTER_TAPS}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float w = exp(-float(k * k) * inv2s2);
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    acc += w * texture(u_input, vec2((nx + 0.5) / u_res.x, (ny + 0.5) / u_res.y)).rgb;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}
`;

// Pass 3 — detect, add quantum mottle, and develop to the display convention.
export const XRAY_DEVELOP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_primary;
uniform sampler2D u_scatter;
uniform vec2 u_res;
uniform float u_scatterMix;
uniform float u_dose;
uniform float u_mottle;
uniform float u_seed;
uniform int u_positive;
uniform vec3 u_tint;
uniform float u_tintStrength;
${SRGB_GLSL}

// Deterministic per-pixel hash (coords + frame seed) — no Math.random, so the
// mottle is stable for a given frame instead of shimmering between redraws.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec4 src = texture(u_source, v_uv);
  float primary = texture(u_primary, v_uv).r;
  float scattered = texture(u_scatter, v_uv).r;
  // Veiling glare: detected = (1-s)*primary + s*scatter. The broad pedestal
  // lowers subject contrast, exactly as Compton scatter does on real film.
  float transmission = mix(primary, scattered, clamp(u_scatterMix, 0.0, 1.0));

  // Quantum mottle. N ~ Poisson(dose * T) quanta reach the detector and the
  // transmission estimate is T_hat = N/dose, so Var(T_hat) = T/dose and the
  // ABSOLUTE sigma is sqrt(T/dose). Dense regions look the noisiest not because
  // sigma is bigger there but because the SNR collapses: sigma/T = 1/sqrt(N).
  // Box-Muller turns two uniform hashes into the Gaussian limit of the deviate.
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  float u1 = max(hash13(vec3(floor(pixel), u_seed)), 1e-6);
  float u2 = hash13(vec3(floor(pixel) + 17.31, u_seed + 5.77));
  float gaussian = sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
  float amplitude = ${MOTTLE_AMPLITUDE_GLSL};
  // Only the physical floor is applied: a photon count cannot go negative, but
  // an unattenuated estimate T_hat = N/dose may legitimately exceed 1. Clamping
  // T to [0,1] here would throw away every upward excursion in the open beam
  // and leave one-sided specks, so the deviate stays symmetric and the single
  // range clamp happens once at the linear->sRGB encode.
  transmission = max(0.0, transmission + amplitude * gaussian);

  // Film records TRANSMITTED intensity, so dense material exposes less film and
  // reads white on a lightbox: the positive view shows 1-T.
  float intensity = u_positive == 1 ? 1.0 - transmission : transmission;

  // Radiographs are viewed with a cool cast; tint in linear light.
  vec3 tintLin = oc_srgbToLinear(clamp(u_tint / 255.0, 0.0, 1.0));
  vec3 rgbLin = vec3(intensity) * mix(vec3(1.0), tintLin, clamp(u_tintStrength, 0.0, 1.0));
  fragColor = vec4(oc_linearToSrgb(rgbLin), src.a);
}
`;

type GLCache = { attenuate: Program; blur: Program; develop: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    attenuate: linkProgram(gl, XRAY_ATTENUATE_FS, [
      "u_source", "u_attenuation", "u_densitySource",
    ] as const),
    blur: linkProgram(gl, XRAY_BLUR_FS, [
      "u_input", "u_res", "u_axis", "u_radius", "u_sigma",
    ] as const),
    develop: linkProgram(gl, XRAY_DEVELOP_FS, [
      "u_source", "u_primary", "u_scatter", "u_res", "u_scatterMix", "u_dose",
      "u_mottle", "u_seed", "u_positive", "u_tint", "u_tintStrength",
    ] as const),
  };
  return _glCache;
};

const xray = (input: any, options: Partial<typeof defaults> = defaults) => {
  const runtime = options as Partial<typeof defaults> & { _frameIndex?: number };
  const densitySource = normalizeEnumOption(
    options.densitySource,
    [DENSITY_SOURCE.LUMA, DENSITY_SOURCE.INVERSE_LUMA],
    defaults.densitySource,
  );
  const display = normalizeEnumOption(
    options.display, [DISPLAY.POSITIVE, DISPLAY.NEGATIVE], defaults.display);
  const attenuation = normalizeRangeOption(options.attenuation, defaults.attenuation, 0, 8);
  const scatter = normalizeRangeOption(options.scatter, defaults.scatter, 0, 1);
  const scatterRadius = normalizeRangeOption(
    options.scatterRadius, defaults.scatterRadius, 1, MAX_SCATTER_RADIUS, true);
  const dose = normalizeRangeOption(options.dose, defaults.dose, 4, 400);
  const mottle = normalizeRangeOption(options.mottle, defaults.mottle, 0, 1);
  const tint = normalizeColorOption(options.tint, defaults.tint);
  const tintStrength = normalizeRangeOption(options.tintStrength, defaults.tintStrength, 0, 1);
  const frameIndex = normalizeRangeOption(runtime._frameIndex, 0, 0, 1e9, true);

  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const cache = initGLCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "xray:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  // Transmission is a linear-light quantity whose tail is smooth; render into
  // RGBA16F where available so the scatter pedestal does not band, and fall
  // back to 8-bit when EXT_color_buffer_float is unavailable.
  const linTex = (name: string): TexEntry =>
    ensureFloatTexture(gl, name, W, H) ?? ensureTexture(gl, name, W, H);
  const primaryTex = linTex("xray:primary");
  const tmpTex = linTex("xray:tmp");
  const scatterTex = linTex("xray:scatter");

  drawPass(gl, primaryTex, W, H, cache.attenuate, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.attenuate.uniforms.u_source, 0);
    gl.uniform1f(cache.attenuate.uniforms.u_attenuation, attenuation);
    gl.uniform1i(
      cache.attenuate.uniforms.u_densitySource,
      densitySource === DENSITY_SOURCE.INVERSE_LUMA ? 1 : 0,
    );
  }, vao);

  // sigma = r/3, so the 3σ support is exactly scatterRadius pixels and the tap
  // bound below never truncates: every setting on the slider delivers its full
  // nominal spread, at the cost of one tap per pixel of radius.
  const sigma = sigmaForRadius(scatterRadius);
  const loopRadius = Math.min(MAX_SCATTER_TAPS, Math.max(1, Math.ceil(sigma * 3)));
  const gaussianPass = (src: TexEntry, dst: TexEntry, axisX: number, axisY: number): void => {
    drawPass(gl, dst, W, H, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, W, H);
      gl.uniform2f(cache.blur.uniforms.u_axis, axisX, axisY);
      gl.uniform1i(cache.blur.uniforms.u_radius, loopRadius);
      gl.uniform1f(cache.blur.uniforms.u_sigma, sigma);
    }, vao);
  };
  gaussianPass(primaryTex, tmpTex, 1, 0);
  gaussianPass(tmpTex, scatterTex, 0, 1);

  drawPass(gl, null, W, H, cache.develop, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.develop.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, primaryTex.tex);
    gl.uniform1i(cache.develop.uniforms.u_primary, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, scatterTex.tex);
    gl.uniform1i(cache.develop.uniforms.u_scatter, 2);
    gl.uniform2f(cache.develop.uniforms.u_res, W, H);
    gl.uniform1f(cache.develop.uniforms.u_scatterMix, scatter);
    gl.uniform1f(cache.develop.uniforms.u_dose, dose);
    gl.uniform1f(cache.develop.uniforms.u_mottle, mottle);
    gl.uniform1f(cache.develop.uniforms.u_seed, frameIndex * 1.618);
    gl.uniform1i(cache.develop.uniforms.u_positive, display === DISPLAY.POSITIVE ? 1 : 0);
    gl.uniform3f(cache.develop.uniforms.u_tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(cache.develop.uniforms.u_tintStrength, tintStrength);
  }, vao);

  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("X-Ray", "WebGL2", `${display} mu*t=${attenuation} dose=${dose}`);
  return output;
};

export default defineFilter({
  name: "X-Ray",
  func: xray,
  optionTypes,
  options: defaults,
  defaults,
  description: "Beer–Lambert radiograph proxy — a photograph carries no radiodensity data, so image luminance stands in for path-integrated density — with Compton-scatter veiling glare and dose-dependent quantum mottle",
  requiresGL: true,
});
