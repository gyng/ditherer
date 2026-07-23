import { COLOR, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  normalizeColorOption,
  normalizeRangeOption,
} from "../utils/filterOptions";
import { SRGB_GLSL } from "./opticalConvolutionContracts";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

// ---------------------------------------------------------------------------
// Scanning Electron Micrograph
//
// HONEST FRAMING: there is no real specimen and no real topography here. A
// scanning electron microscope measures secondary electrons escaping a physical
// surface; this filter has only a picture. It reads the source image's LINEAR
// luminance as if it were a heightfield, derives surface normals from that
// invented relief, and runs the genuine SEM contrast physics over them. The
// physics below is the real thing; the surface it is applied to is not. Nothing
// produced here is a micrograph of anything.
//
// Physics implemented:
//
// - Secant law. The escape depth of secondary electrons is a few nanometres,
//   so tilting the surface by θ away from the beam lengthens the beam's path
//   inside that escape layer by 1/cos θ and the SE yield rises as
//       δ(θ) = δ₀ · sec θ = δ₀ / cos θ
//   with θ the angle between the surface normal and the incident beam. This is
//   why SEM images have their signature bright edges and rims: at a rim the
//   local normal turns nearly perpendicular to the beam, cos θ → 0, and the
//   yield blows up. Real detectors and video amplifiers saturate long before
//   infinity, so the raw secant is soft-knee limited (see softSaturateYield).
//
// - δ₀ is material dependent, so the source's linear luminance also modulates
//   δ₀ itself — the stand-in for composition contrast between flat regions.
//
// - Everhart–Thornley detector directionality. The E-T scintillator sits off to
//   one side of the chamber, so collection efficiency depends on where the
//   local normal points relative to the detector: dot(N, detectorDir). Its
//   positively-biased collector grid sweeps in low-energy secondaries even from
//   faces turned away, so the directional term has a floor rather than a hard
//   shadow. This is the classic "lit from one side" topographic look.
//
// - Scan artefacts: line-to-line raster gain drift, Poisson shot noise from a
//   finite number of collected electrons (relative noise ∝ 1/√N), and localised
//   charging on steep insulating slopes that streaks along the scan direction
//   as the accumulated charge bleeds off. All deterministic hashes of pixel
//   coordinates plus an optional frame index — no Math.random anywhere. The
//   video amplifier (`gain`) sits LAST, after every artefact, because that is
//   where it sits in the instrument: gain 0 is a black frame.
//
// Signal chain: height -> normal -> sec θ yield -> saturation -> detector ->
// charging -> line drift -> shot noise -> amplifier gain -> tint -> sRGB.
//
// - Output is monochrome: an SEM counts electrons, not photons, so there is no
//   colour to record. The tint control only stains the display.
//
// All yield/signal maths runs in LINEAR light: the source is linearised once,
// luminance/height and every downstream term live in linear, and the result is
// re-encoded to sRGB exactly once at output.
// ---------------------------------------------------------------------------

/** Below this the secant law is treated as saturated; keeps yield finite. */
export const SEM_COS_EPSILON = 0.02;

/**
 * Fraction of δ₀ that survives on a black pixel. Source luminance stands in for
 * composition contrast (δ₀ really is material dependent), but a pixel of zero
 * luminance is not a material with zero yield, so the modulation has a floor.
 */
export const SEM_MATERIAL_FLOOR = 0.06;

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/**
 * Secant-law secondary-electron yield: δ(θ) = δ₀ · sec θ = δ₀ / cos θ.
 *
 * `cosTheta` is dot(surfaceNormal, beamDirection) with the beam along +Z, so
 * cos θ = 1 is normal incidence (yield = δ₀) and cos θ → 0 is grazing incidence
 * (yield → ∞ in theory, floored at SEM_COS_EPSILON here so a rim pixel bloomed
 * to its clamp instead of producing Infinity/NaN).
 */
export const secondaryElectronYield = (cosTheta: number, delta0: number): number => {
  const d0 = Math.max(0, finite(delta0, 1));
  const c = Math.min(1, Math.max(0, finite(cosTheta, 1)));
  return d0 / Math.max(c, SEM_COS_EPSILON);
};

/**
 * Soft-knee saturation of the raw yield, `ceiling · δ / (ceiling + δ)`. Linear
 * (≈ δ) for small yields, asymptotic to `ceiling` as δ → ∞ — the detector and
 * video chain running out of headroom, so edges bloom without blowing up.
 */
export const softSaturateYield = (yieldValue: number, ceiling: number): number => {
  const y = Math.max(0, finite(yieldValue, 0));
  const c = Math.max(1e-3, finite(ceiling, 1));
  return (c * y) / (c + y);
};

/**
 * Local δ₀ for a pixel: the material-dependent normal-incidence yield, with the
 * source's linear luminance standing in for composition contrast.
 */
export const semLocalBaseYield = (height: number, baseYield: number): number => {
  const h = Math.min(1, Math.max(0, finite(height, 0)));
  const d0 = Math.max(0, finite(baseYield, 1));
  return d0 * (SEM_MATERIAL_FLOOR + (1 - SEM_MATERIAL_FLOOR) * h);
};

/**
 * Surface normal of the invented heightfield: N = normalize(-dh/dx, -dh/dy,
 * 1/heightScale). `dhdx`/`dhdy` are luminance-per-texel gradients; a larger
 * heightScale exaggerates relief and drives cos θ toward 0 at edges.
 *
 * Note the units: a per-texel central difference of LINEAR luminance is tiny on
 * ordinary imagery (|∇h| ≈ 0.01–0.05, only ~0.4 across a hard sRGB step), so
 * heightScale has to be well above 1 for the surface to tilt at all — at
 * heightScale 1 the steepest ordinary pixel still has cos θ ≈ 0.99 and the
 * secant law is inert. The `relief` control IS this scale (default 24), tuned so
 * stock settings put the steepest 5% of an ordinary frame at sec θ ≈ 2.7.
 */
export const surfaceNormalFromHeightGradient = (
  dhdx: number,
  dhdy: number,
  heightScale: number,
): [number, number, number] => {
  const gx = finite(dhdx, 0);
  const gy = finite(dhdy, 0);
  const nz = 1 / Math.max(1e-3, finite(heightScale, 1));
  const length = Math.hypot(-gx, -gy, nz) || 1;
  return [-gx / length, -gy / length, nz / length];
};

/**
 * Everhart–Thornley collection efficiency for a normal: dot(N, detectorDir),
 * clamped to the collector-grid floor so faces turned away from the detector
 * stay dim rather than black.
 */
export const everhartThornleyResponse = (
  normal: readonly [number, number, number],
  azimuthRad: number,
  elevationRad: number,
  floorTerm = 0.25,
): number => {
  const az = finite(azimuthRad, 0);
  const el = finite(elevationRad, 0);
  const dx = Math.cos(az) * Math.cos(el);
  const dy = Math.sin(az) * Math.cos(el);
  const dz = Math.sin(el);
  const raw = finite(normal[0], 0) * dx + finite(normal[1], 0) * dy + finite(normal[2], 1) * dz;
  const f = Math.min(1, Math.max(0, finite(floorTerm, 0)));
  return f + (1 - f) * Math.min(1, Math.max(0, raw));
};

export const optionTypes = {
  relief: { type: RANGE, range: [1, 80], step: 0.5, default: 24, desc: "How strongly source luminance is read as surface height" },
  baseYield: { type: RANGE, range: [0.1, 3], step: 0.05, default: 1, desc: "Secondary-electron yield at normal incidence (δ₀)" },
  yieldCeiling: { type: RANGE, range: [1, 16], step: 0.5, default: 4, desc: "Where the detector saturates, limiting the sec θ edge bloom" },
  detectorAzimuth: { type: RANGE, range: [0, 360], step: 1, default: 135, desc: "Where the Everhart-Thornley detector sits around the stage" },
  detectorElevation: { type: RANGE, range: [5, 85], step: 1, default: 30, desc: "Height of the detector above the specimen plane" },
  detectorMix: { type: RANGE, range: [0, 1], step: 0.01, default: 0.45, desc: "Directional detector shading versus pure yield contrast" },
  gain: { type: RANGE, range: [0, 3], step: 0.05, default: 1, desc: "Video amplifier gain, applied last to everything the detector collected" },
  scanJitter: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Line-to-line gain drift across the raster" },
  shotNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Shot noise from a finite count of collected electrons" },
  charging: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Charge build-up streaking off the steepest slopes" },
  tint: { type: COLOR, default: [255, 255, 255], desc: "Display stain on the monochrome electron signal; hue only, exposure stays with gain" },
};

export const defaults = {
  relief: optionTypes.relief.default,
  baseYield: optionTypes.baseYield.default,
  yieldCeiling: optionTypes.yieldCeiling.default,
  detectorAzimuth: optionTypes.detectorAzimuth.default,
  detectorElevation: optionTypes.detectorElevation.default,
  detectorMix: optionTypes.detectorMix.default,
  gain: optionTypes.gain.default,
  scanJitter: optionTypes.scanJitter.default,
  shotNoise: optionTypes.shotNoise.default,
  charging: optionTypes.charging.default,
  tint: optionTypes.tint.default,
};

type SemOptions = FilterOptionValues & Partial<typeof defaults> & {
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_relief;
uniform float u_delta0;
uniform float u_ceiling;
uniform float u_detAz;
uniform float u_detEl;
uniform float u_detMix;
uniform float u_gain;
uniform float u_jitter;
uniform float u_shot;
uniform float u_charging;
uniform vec3  u_tint;
uniform float u_seed;

const float SEM_COS_EPSILON = ${SEM_COS_EPSILON.toFixed(4)};
const float SEM_MATERIAL_FLOOR = ${SEM_MATERIAL_FLOOR.toFixed(4)};

${SRGB_GLSL}

float sem_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sem_hash11(float x) { return sem_hash12(vec2(x, x * 0.7331 + 11.7)); }

// Linear-light luminance of the source, used as the invented heightfield.
float sem_height(vec2 uv) {
  vec3 lin = oc_srgbToLinear(clamp(texture(u_source, clamp(uv, 0.0, 1.0)).rgb, 0.0, 1.0));
  return dot(lin, vec3(0.2126, 0.7152, 0.0722));
}

// N = normalize(-dh/dx, -dh/dy, 1/heightScale) from central differences.
//
// Axis convention: this filter's textures are uploaded with
// UNPACK_FLIP_Y_WEBGL=true and read back through the drawImage flip, so v_uv.y
// runs UPWARD in the displayed image (gl/index.ts's readClamped maps JS row 0 to
// v = 1). hU/hD below really are the pixels above/below, and detector azimuth
// therefore matches its nominal compass direction — verified in-browser: with a
// ramp whose normal faces the top of the frame, azimuth 90 renders brighter
// (185.8 mean luma) than azimuth 270 (165.7).
vec3 sem_normal(vec2 uv, vec2 texel) {
  float hL = sem_height(uv - vec2(texel.x, 0.0));
  float hR = sem_height(uv + vec2(texel.x, 0.0));
  float hD = sem_height(uv - vec2(0.0, texel.y));
  float hU = sem_height(uv + vec2(0.0, texel.y));
  float dhdx = (hR - hL) * 0.5;
  float dhdy = (hU - hD) * 0.5;
  return normalize(vec3(-dhdx, -dhdy, 1.0 / max(1e-3, u_relief)));
}

// Secant law: delta(theta) = delta0 / cos(theta), floored so a rim is finite.
float sem_yield(float cosTheta, float delta0) {
  return max(0.0, delta0) / max(clamp(cosTheta, 0.0, 1.0), SEM_COS_EPSILON);
}

// Soft-knee detector/amplifier saturation: ceiling*y/(ceiling+y).
float sem_saturate(float y, float ceiling) {
  float c = max(1e-3, ceiling);
  return (c * max(0.0, y)) / (c + max(0.0, y));
}

void main() {
  vec2 texel = 1.0 / max(u_res, vec2(1.0));
  vec4 src = texture(u_source, v_uv);

  vec3 n = sem_normal(v_uv, texel);
  float cosTheta = n.z;             // beam along +Z, so cos(theta) = dot(N, beam)
  float height = sem_height(v_uv);

  // delta0 is material dependent; source luminance stands in for composition.
  float delta0 = u_delta0 * (SEM_MATERIAL_FLOOR + (1.0 - SEM_MATERIAL_FLOOR) * height);
  float delta = sem_yield(cosTheta, delta0);
  // No 1/delta0 normalisation here: dividing by delta0 would make the "yield at
  // normal incidence" control DARKEN the image, since sat(k*x,C)/k falls with k.
  float signal = sem_saturate(delta, u_ceiling);

  // Everhart-Thornley directionality, normalised against a flat face so the
  // mix control changes look and not overall exposure.
  vec3 detDir = vec3(cos(u_detAz) * cos(u_detEl), sin(u_detAz) * cos(u_detEl), sin(u_detEl));
  float det = 0.25 + 0.75 * clamp(dot(n, detDir), 0.0, 1.0);
  float detFlat = 0.25 + 0.75 * clamp(sin(u_detEl), 0.0, 1.0);
  signal *= mix(1.0, det / max(1e-3, detFlat), u_detMix);

  vec2 px = floor(v_uv * u_res);

  // Localised charging: steep insulating slopes accumulate charge that bleeds
  // off along the scan direction, leaving a bright streak trailing the slope.
  if (u_charging > 0.0) {
    float streak = 0.0;
    for (int k = 1; k <= 6; k++) {
      float fk = float(k);
      float cz = sem_normal(v_uv - vec2(fk * texel.x, 0.0), texel).z;
      float steep = max(0.0, 1.0 - cz);
      streak += steep * steep * exp(-fk * 0.4);
    }
    signal += streak * u_charging * 0.9 * (0.6 + 0.8 * sem_hash11(px.y + u_seed));
  }

  // Raster line-to-line gain drift: the whole scan line rides up to +/-50%*
  // jitter high or low (+/-12.5% at the default), so it reads as horizontal
  // banding rather than per-pixel grain.
  signal *= 1.0 + (sem_hash11(px.y * 1.37 + u_seed * 3.1) - 0.5) * u_jitter;

  // Shot noise: relative noise falls as 1/sqrt(collected electrons).
  if (u_shot > 0.0) {
    float g = (sem_hash12(px + u_seed)
      + sem_hash12(px.yx * 1.31 + u_seed * 1.7)
      + sem_hash12(px * 0.77 + u_seed * 2.3) - 1.5) * 1.15;
    signal += g * u_shot * 0.35 * sqrt(max(signal, 0.0));
  }

  // Video amplifier is LAST in the chain: it amplifies everything the detector
  // collected, artifacts included, so gain 0 really is a black frame.
  signal *= u_gain;

  // Monochrome: an SEM counts electrons, not photons. Tint only stains the
  // display, so it is normalised by its BRIGHTEST channel, not by its
  // luminance. Luminance normalisation blew the image out at saturated hues —
  // pure blue has luma 0.0722, so dividing by it scales 13.85x and every pixel
  // above signal 0.072 clipped to a flat 0/0/255 silhouette. Peak-normalised,
  // the dominant channel carries the untouched tonal range and no channel can
  // ever exceed the signal, so a saturated stain is still a full micrograph.
  // Exposure stays with the gain control: white is an exact no-op, as is grey.
  vec3 tintLin = oc_srgbToLinear(clamp(u_tint, 0.0, 1.0));
  tintLin /= max(1e-4, max(tintLin.r, max(tintLin.g, tintLin.b)));
  vec3 lin = clamp(vec3(max(signal, 0.0)) * tintLin, 0.0, 1.0);
  fragColor = vec4(oc_linearToSrgb(lin), src.a);
}
`;

const UNIFORMS = [
  "u_source", "u_res", "u_relief", "u_delta0", "u_ceiling", "u_detAz", "u_detEl",
  "u_detMix", "u_gain", "u_jitter", "u_shot", "u_charging", "u_tint", "u_seed",
] as const;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, UNIFORMS);
  return _prog;
};

const scanningElectronMicrograph = (
  input: HTMLCanvasElement | OffscreenCanvas,
  options: SemOptions = defaults,
) => {
  const supplied = { ...defaults, ...options };
  const relief = normalizeRangeOption(supplied.relief, defaults.relief, 1, 80);
  const baseYield = normalizeRangeOption(supplied.baseYield, defaults.baseYield, 0.1, 3);
  const yieldCeiling = normalizeRangeOption(supplied.yieldCeiling, defaults.yieldCeiling, 1, 16);
  const detectorAzimuth = normalizeRangeOption(supplied.detectorAzimuth, defaults.detectorAzimuth, 0, 360);
  const detectorElevation = normalizeRangeOption(supplied.detectorElevation, defaults.detectorElevation, 5, 85);
  const detectorMix = normalizeRangeOption(supplied.detectorMix, defaults.detectorMix, 0, 1);
  const gain = normalizeRangeOption(supplied.gain, defaults.gain, 0, 3);
  const scanJitter = normalizeRangeOption(supplied.scanJitter, defaults.scanJitter, 0, 1);
  const shotNoise = normalizeRangeOption(supplied.shotNoise, defaults.shotNoise, 0, 1);
  const charging = normalizeRangeOption(supplied.charging, defaults.charging, 0, 1);
  const tint = normalizeColorOption(supplied.tint, defaults.tint);
  const frameIndex = normalizeRangeOption(supplied._frameIndex, 0, 0, 1e9, true);

  const W = input.width, H = input.height;
  if (!glAvailable()) return glUnavailableStub(W, H);
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "scanningElectronMicrograph:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_relief, relief);
    gl.uniform1f(prog.uniforms.u_delta0, baseYield);
    gl.uniform1f(prog.uniforms.u_ceiling, yieldCeiling);
    gl.uniform1f(prog.uniforms.u_detAz, (detectorAzimuth * Math.PI) / 180);
    gl.uniform1f(prog.uniforms.u_detEl, (detectorElevation * Math.PI) / 180);
    gl.uniform1f(prog.uniforms.u_detMix, detectorMix);
    gl.uniform1f(prog.uniforms.u_gain, gain);
    gl.uniform1f(prog.uniforms.u_jitter, scanJitter);
    gl.uniform1f(prog.uniforms.u_shot, shotNoise);
    gl.uniform1f(prog.uniforms.u_charging, charging);
    gl.uniform3f(prog.uniforms.u_tint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
    gl.uniform1f(prog.uniforms.u_seed, ((frameIndex * 7919 + 104729) % 1000000) * 0.001);
  }, vao);

  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Scanning Electron Micrograph", "WebGL2",
    `relief=${relief} delta0=${baseYield} detector=${detectorAzimuth}deg`);
  return output;
};

export default defineFilter({
  name: "Scanning Electron Micrograph",
  func: scanningElectronMicrograph,
  optionTypes,
  options: defaults,
  defaults,
  description: "Reads image luminance as invented topography — there is no real specimen — then runs SEM contrast over it: secant-law secondary-electron yield (δ₀ sec θ) for bright rims, off-axis Everhart-Thornley shading, scan-line drift, shot noise, and charging streaks, in monochrome",
  requiresGL: true,
});
