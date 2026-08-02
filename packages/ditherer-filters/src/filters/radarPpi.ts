// Radar PPI (Plan Position Indicator).
//
// HONEST FRAMING: there is no radar here. A camera image carries no radar
// returns, so this filter *stands image luminance in for target reflectivity*
// (radar cross-section) and paints that stand-in through a real PPI signal
// chain. The geometry, the range law, the sweep, and the phosphor decay are
// physical; the "echoes" are the picture you fed it.
//
// The physics that is real:
//
// * Radar equation — Pr = (Pt·G²·λ²·σ) / ((4π)³·R⁴), so received power falls
//   as 1/R⁴ with range. `rangeAttenuation` implements exactly that, floored at
//   a minimum range. That floor is numerical, not physical: it exists only to
//   stop 1/R⁴ diverging at the origin, and it clamps the return to its MAXIMUM
//   there, so the scope centre is the brightest part of the display. (A real
//   transmit-pulse blanking interval would do the opposite and darken it.)
// * STC (sensitivity time control) — the receiver gain is ramped up with range
//   as R^(4·stc) so strong near-range returns do not saturate the display.
//   stc = 1 cancels the range law completely; stc = 0 leaves it raw.
// * Logarithmic receiver — a real PPI drives its CRT from a LOG amplifier
//   because the radar equation's dynamic range is far larger than a phosphor's.
//   The `video` term below is that log compression.
// * Phosphor persistence — after the rotating beam paints a cell, its
//   brightness decays as B = B₀·exp(−Δφ/τ) in *elapsed sweep angle*, which is
//   why the trail follows behind the sweep and wraps correctly at 2π.
// * Clutter — sea clutter is surface backscatter (spiky, K-distributed-ish,
//   dies away quickly with range); rain clutter is volume backscatter (diffuse,
//   Rayleigh-ish, spread over a larger depth). Both concentrate at short range.
//
// Alpha: the scope composites onto its own phosphor face, but it occupies the
// source footprint, so source alpha is carried through unchanged (a translucent
// input stays translucent, including the masked-off corners outside the scope).
//
// Signal accumulation is emission, so all of it — echo, clutter, persistence,
// graticule — is summed in LINEAR light and encoded to sRGB exactly once.
//
// Known limits at extreme settings. The graticule is drawn at a constant width
// in PIXELS, which is what keeps it looking like an overlay rather than part of
// the image — but it means these three are geometry, not bugs:
//
// * Dense spokes on a small canvas. The spoke convergence zone blanked at the
//   origin has an absolute pixel radius (LINE_OUTER·spokes/π), so on a small
//   field a high spoke count eats a large share of the scope: at `spokes: 36`
//   over a 96×96 input (scope radius 47 px) roughly the inner 45% carries no
//   spokes and the outer stubs are short. Defensible — those bearings really
//   are unresolvable that close to the origin — but it is size-dependent.
// * Dense rings on a small canvas. The nearest-index ring test clips the ring
//   flanks once the spacing drops under the smoothstep width, i.e. when
//   scopeR < 3.2·(rings+1). `rings: 12` therefore wants scopeR ≳ 42 px (about
//   an 85 px input at the default scopeScale); below that the rings still land
//   in the right places but get hard edges instead of a smooth falloff.
// * The rim circle reads thinner and harder than the interior rings. It is
//   drawn with a 1.8 px half-width, but everything at r > 1.0 takes the early
//   out above, so only its inner half survives.

import { BOOL, COLOR, ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  normalizeBooleanOption,
  normalizeColorOption,
  normalizeEnumOption,
  normalizeRangeOption,
} from "../utils/filterOptions";
import { SRGB_GLSL } from "./opticalConvolutionContracts";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  glAvailable,
  glUnavailableStub,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Range floor, as a fraction of the display radius, below which `1/R⁴` is held
 * constant. This is divergence control, nothing more: without it the origin
 * would be infinitely bright. Note that it clamps the return to its maximum, so
 * `r < RADAR_MIN_RANGE` is the BRIGHTEST region of the scope — it does not
 * model transmit-pulse blanking, which would darken the origin instead. Both
 * the kernel and the shader floor at this value.
 */
export const RADAR_MIN_RANGE = 0.04;

/**
 * Calibration range: the normalized range at which the receiver chain has unity
 * gain. Attenuation is reported relative to here so the picture is not either
 * all-white at the origin or all-black at the rim.
 */
export const RADAR_REF_RANGE = 0.25;

const finite = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/**
 * Radar-equation range falloff: received power Pr ∝ 1/R⁴.
 *
 * `r` is normalized slant range (1 = scope rim). Floored at `minRange` so the
 * blanked near field is finite. Strictly decreasing above the floor, and
 * doubling the range divides the return by 16.
 */
export const rangeAttenuation = (r: number, minRange: number = RADAR_MIN_RANGE): number => {
  const floorR = Math.max(1e-6, finite(minRange, RADAR_MIN_RANGE));
  const rr = Math.max(finite(r, 0), floorR);
  const r2 = rr * rr;
  return 1 / (r2 * r2);
};

/**
 * STC (sensitivity time control): receiver gain ramped as R^(4·stc) with range.
 * `stc` = 0 is raw video, `stc` = 1 exactly cancels the 1/R⁴ falloff.
 */
export const stcGain = (r: number, stc: number, minRange: number = RADAR_MIN_RANGE): number => {
  const floorR = Math.max(1e-6, finite(minRange, RADAR_MIN_RANGE));
  const rr = Math.max(finite(r, 0), floorR);
  const s = Math.min(1, Math.max(0, finite(stc, 0)));
  return Math.pow(rr, 4 * s);
};

/**
 * Phosphor persistence: B = B₀·exp(−Δφ/τ), with Δφ the sweep angle elapsed
 * since the beam last painted this cell and τ the persistence constant (same
 * angular units as Δφ — radians throughout this module).
 */
export const persistenceDecay = (deltaPhi: number, tau: number): number =>
  Math.exp(-Math.max(0, finite(deltaPhi, 0)) / Math.max(1e-4, finite(tau, 1e-4)));

/**
 * Mean of `persistenceDecay` over a full revolution: (τ/2π)·(1 − exp(−2π/τ)).
 *
 * This is what a cell that subtends EVERY bearing at once settles at, which is
 * the case at the scope origin — angular resolution collapses there, so the
 * bearing-dependent terms are faded into this value rather than sampling a
 * bearing that does not exist.
 */
export const meanPersistence = (tau: number): number => {
  const t = Math.max(1e-4, finite(tau, 1e-4));
  return (t * (1 - Math.exp(-TWO_PI / t))) / TWO_PI;
};

/**
 * Wrap an angle into [0, 2π). Both angular kernels below go through this so
 * their boundary handling cannot drift apart.
 *
 * Two floating-point hazards, both guarded here:
 * - a non-finite input — including a subtraction that overflowed to ±Infinity —
 *   would otherwise propagate as NaN;
 * - for an input a hair either side of a multiple of 2π, `floor` disagrees with
 *   the subtraction and the result lands on exactly 2π (from a tiny negative
 *   angle) or a hair below zero (from an angle just under k·2π).
 */
const wrapTurn = (angle: number): number => {
  const a = finite(angle, 0);
  let wrapped = a - TWO_PI * Math.floor(a / TWO_PI);
  if (wrapped >= TWO_PI) wrapped -= TWO_PI;
  return wrapped < 0 ? 0 : wrapped;
};

/**
 * Sweep angle elapsed since the beam last crossed `bearing`, wrapped into
 * [0, 2π). A cell just *behind* the sweep returns a small angle (bright); a
 * cell just *ahead* of it has to wait almost a full revolution, so it returns
 * nearly 2π (dim). This wrap is what makes the trail follow the sweep.
 */
export const sweepElapsedAngle = (bearing: number, sweep: number): number =>
  // The difference is wrapped, not just the operands: two individually finite
  // extremes can still overflow to ±Infinity when subtracted.
  wrapTurn(finite(sweep, 0) - finite(bearing, 0));

/** Antenna bearing φ(t) = ω·t at a given frame, wrapped into [0, 2π). */
export const sweepBearing = (frameIndex: number, degreesPerFrame: number): number =>
  wrapTurn(finite(frameIndex, 0) * finite(degreesPerFrame, 0) * DEG);

/** GLSL mirror of the kernels above — the shader and the tests must agree. */
export const RADAR_PPI_GLSL = `
const float RP_TWO_PI = 6.28318530717958648;
float rp_rangeAttenuation(float r, float minRange) {
  float rr = max(max(r, 0.0), max(minRange, 1e-6));
  float r2 = rr * rr;
  return 1.0 / max(r2 * r2, 1e-30);
}
float rp_stcGain(float r, float stc, float minRange) {
  float rr = max(max(r, 0.0), max(minRange, 1e-6));
  return pow(rr, 4.0 * clamp(stc, 0.0, 1.0));
}
float rp_persistence(float dPhi, float tau) {
  return exp(-max(dPhi, 0.0) / max(tau, 1e-4));
}
float rp_meanPersistence(float tau) {
  float t = max(tau, 1e-4);
  return t * (1.0 - exp(-RP_TWO_PI / t)) / RP_TWO_PI;
}
float rp_elapsed(float bearing, float sweep) {
  float d = sweep - bearing;
  float w = d - RP_TWO_PI * floor(d / RP_TWO_PI);
  // Keep the result strictly in [0, 2pi): for a tiny negative d the subtraction
  // rounds up to exactly 2pi.
  if (w >= RP_TWO_PI) w -= RP_TWO_PI;
  return max(w, 0.0);
}
`;

const CLUTTER = { NONE: "NONE", SEA: "SEA", RAIN: "RAIN", BOTH: "BOTH" } as const;
type ClutterMode = (typeof CLUTTER)[keyof typeof CLUTTER];
const CLUTTER_VALUES: readonly ClutterMode[] = [
  CLUTTER.NONE,
  CLUTTER.SEA,
  CLUTTER.RAIN,
  CLUTTER.BOTH,
];
const clutterId: Record<string, number> = { NONE: 0, SEA: 1, RAIN: 2, BOTH: 3 };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_sweep;
uniform float u_tau;
uniform float u_beam;
uniform float u_gain;
uniform float u_stc;
uniform float u_clutter;
uniform float u_clutterRange;
uniform int u_clutterMode;
uniform float u_clutterSeed;
uniform float u_rings;
uniform float u_spokes;
uniform float u_graticule;
uniform float u_scope;
uniform vec3 u_phosphor;
uniform vec3 u_background;

${SRGB_GLSL}
${RADAR_PPI_GLSL}

const float RP_MIN_RANGE = ${RADAR_MIN_RANGE.toFixed(6)};
const float RP_REF_RANGE = ${RADAR_REF_RANGE.toFixed(6)};
const float RP_PI = 3.14159265358979324;
// Radius, in pixels, over which angular resolution collapses onto the origin.
const float RP_ORIGIN_PX = 1.5;
// Inner/outer edges of the constant-width graticule line smoothstep, in pixels.
const float RP_LINE_INNER = 0.4;
const float RP_LINE_OUTER = 1.6;

// Deterministic value hash. No Math.random anywhere in the shader; the frame
// index only enters through u_clutterSeed, so the speckle boils reproducibly.
float rp_hash(vec3 p) {
  vec3 q = fract(p * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  // JS-y pixel coordinates (textures are uploaded with UNPACK_FLIP_Y=true).
  vec2 px = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 centre = u_res * 0.5;
  float scopeR = max(min(u_res.x, u_res.y) * 0.5 * u_scope, 1.0);
  vec2 d = px - centre;
  float rPix = length(d);
  float r = rPix / scopeR;

  vec4 src = texture(u_source, v_uv);
  vec3 bg = oc_srgbToLinear(clamp(u_background / 255.0, 0.0, 1.0));
  vec3 phosphor = oc_srgbToLinear(clamp(u_phosphor / 255.0, 0.0, 1.0));

  // Circular scope: nothing exists outside the display radius.
  if (r > 1.0) {
    fragColor = vec4(oc_linearToSrgb(bg), src.a);
    return;
  }

  // Bearing: 0 = up (north), increasing clockwise, as on a real PPI.
  //
  // atan(y, x) is undefined at exactly vec2(0.0), and one fragment lands there
  // whenever both dimensions are odd — so the origin cell would take a
  // driver-dependent bearing (or NaN, giving a stuck black dot). Physically the
  // beam's angular resolution collapses at the origin: that cell subtends every
  // bearing at once. Fade the bearing-dependent terms into their all-bearing
  // mean across the innermost pixel or so, which is both well defined and
  // continuous with the neighbours.
  float bearing = rPix < 1e-6 ? 0.0 : atan(d.x, -d.y);
  if (bearing < 0.0) bearing += RP_TWO_PI;
  float dPhi = rp_elapsed(bearing, u_sweep);
  float originFade = smoothstep(0.0, RP_ORIGIN_PX, rPix);

  // Target reflectivity stand-in: LINEAR luminance of the source. Real radar
  // cross-section is not luminance; this is the honest substitution.
  float sigma = dot(oc_srgbToLinear(clamp(src.rgb, 0.0, 1.0)), vec3(0.2126, 0.7152, 0.0722));

  // Radar equation 1/R^4, relative to the calibration range, with STC ramping
  // the receiver gain back up as R^(4*stc).
  float atten = rp_rangeAttenuation(r, RP_MIN_RANGE) / rp_rangeAttenuation(RP_REF_RANGE, RP_MIN_RANGE);
  float stcRamp = rp_stcGain(r, u_stc, RP_MIN_RANGE) / rp_stcGain(RP_REF_RANGE, u_stc, RP_MIN_RANGE);
  float echo = sigma * u_gain * atten * stcRamp;

  // Clutter: surface (sea) backscatter is spiky and dies away fast with range;
  // volume (rain) backscatter is diffuse and spread over a greater depth.
  float clutter = 0.0;
  if (u_clutterMode > 0) {
    vec3 cell = vec3(floor(px / 1.0), u_clutterSeed);
    float n = rp_hash(cell);
    float sea = pow(n, 5.0) * exp(-r / max(u_clutterRange, 0.01));
    float rain = (0.35 + 0.65 * rp_hash(cell.yxz)) * exp(-r / max(u_clutterRange * 2.4, 0.01));
    if (u_clutterMode == 1) clutter = sea;
    else if (u_clutterMode == 2) clutter = rain * 0.5;
    else clutter = sea + rain * 0.4;
    clutter *= u_clutter;
  }

  // Logarithmic receiver: the radar equation spans far more dynamic range than
  // a phosphor, so real PPIs drive the CRT from a LOG amplifier.
  float video = log(1.0 + max(echo + clutter, 0.0) * 64.0) / log(65.0);

  // Phosphor persistence: B = B0 * exp(-dPhi / tau), plus the illuminated trace
  // itself (the beam is a finite-width pencil and shows receiver noise even
  // with no target under it).
  float painted = video * mix(rp_meanPersistence(u_tau), rp_persistence(dPhi, u_tau), originFade);
  float beam = mix(rp_meanPersistence(u_beam), rp_persistence(dPhi, u_beam), originFade);
  float trace = beam * (0.28 + 0.72 * video);
  float brightness = clamp(painted + trace, 0.0, 4.0);

  // Range rings and bearing spokes, drawn at constant pixel width.
  float graticule = 0.0;
  if (u_rings >= 1.0) {
    // N rings sit at r = k/(N+1) for k = 1..N, so all N are genuinely visible
    // INSIDE the scope: none degenerates onto the origin (k = 0) and none is
    // drawn coincident with the rim (k = N+1), which would be half-clipped by
    // the r > 1.0 early-out and double-drawn over the rim circle below.
    float spacing = u_rings + 1.0;
    float k = floor(r * spacing + 0.5);
    if (k >= 1.0 && k <= u_rings) {
      float dr = abs(r - k / spacing);
      graticule = max(graticule, 1.0 - smoothstep(RP_LINE_INNER, RP_LINE_OUTER, dr * scopeR));
    }
  }
  if (u_spokes >= 1.0) {
    float spokePhase = bearing * u_spokes / RP_TWO_PI;
    float da = abs(fract(spokePhase + 0.5) - 0.5) / u_spokes * RP_TWO_PI;
    // Spokes are width-tested by arc length (da * rPix) so they stay one pixel
    // wide at every range. That test degenerates as rPix -> 0: every bearing
    // passes it once rPix < RP_LINE_OUTER / (pi / spokes), filling a fixed
    // blob at the origin. Blank that convergence zone. Its size depends on the
    // line width and the spoke count, not on the image size, so this does not
    // scale into a visible speck at high resolution.
    float hubPx = RP_LINE_OUTER * u_spokes / RP_PI;
    float lit = 1.0 - smoothstep(RP_LINE_INNER, RP_LINE_OUTER, da * rPix);
    graticule = max(graticule, lit * smoothstep(hubPx * 1.15, hubPx * 1.7, rPix));
  }
  graticule = max(graticule, 1.0 - smoothstep(RP_LINE_INNER, 1.8, abs(1.0 - r) * scopeR));
  graticule *= u_graticule;

  vec3 lin = bg + phosphor * (brightness + graticule);
  fragColor = vec4(oc_linearToSrgb(lin), src.a);
}
`;

export const optionTypes = {
  gain: {
    type: RANGE,
    range: [0, 6],
    step: 0.05,
    default: 1.6,
    desc: "Receiver gain applied to the range-corrected echo",
  },
  stc: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.55,
    desc: "Sensitivity time control: fraction of the 1/r⁴ range falloff ramped back out",
  },
  sweepSpeed: {
    type: RANGE,
    range: [0, 45],
    step: 0.5,
    default: 6,
    desc: "Antenna rotation rate, in degrees of bearing per frame",
  },
  persistence: {
    type: RANGE,
    range: [2, 360],
    step: 1,
    default: 130,
    desc: "Phosphor persistence τ: sweep angle over which a painted echo falls to 1/e",
  },
  beamWidth: {
    type: RANGE,
    range: [0.2, 30],
    step: 0.1,
    default: 2.5,
    desc: "Angular width of the illuminated sweep trace",
  },
  clutterMode: {
    type: ENUM,
    options: [
      { name: "None", value: CLUTTER.NONE },
      { name: "Sea (surface, spiky)", value: CLUTTER.SEA },
      { name: "Rain (volume, diffuse)", value: CLUTTER.RAIN },
      { name: "Sea and rain", value: CLUTTER.BOTH },
    ],
    default: CLUTTER.SEA,
    desc: "Kind of unwanted backscatter filling the short-range cells",
  },
  clutter: {
    type: RANGE,
    range: [0, 2],
    step: 0.01,
    default: 0.35,
    desc: "Amplitude of the clutter returns near the scope centre",
  },
  clutterRange: {
    type: RANGE,
    range: [0.02, 1],
    step: 0.01,
    default: 0.26,
    desc: "Range over which clutter decays away from the centre",
  },
  clutterBoil: {
    type: BOOL,
    default: true,
    desc: "Reseed the clutter speckle each frame so it boils between sweeps",
  },
  rings: {
    type: RANGE,
    range: [0, 12],
    step: 1,
    default: 5,
    desc: "Number of range rings drawn on the scope face",
  },
  spokes: {
    type: RANGE,
    range: [0, 36],
    step: 1,
    default: 12,
    desc: "Number of radial bearing-graticule spokes",
  },
  graticule: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.22,
    desc: "Brightness of the range rings and bearing graticule",
  },
  scopeScale: {
    type: RANGE,
    range: [0.2, 1.4],
    step: 0.01,
    default: 0.98,
    desc: "Display radius as a fraction of the shorter image side",
  },
  phosphor: { type: COLOR, default: [86, 255, 138], desc: "Phosphor emission colour of the scope" },
  background: {
    type: COLOR,
    default: [4, 14, 8],
    desc: "Unlit scope face colour, inside and outside the display circle",
  },
};

export const defaults = {
  gain: optionTypes.gain.default,
  stc: optionTypes.stc.default,
  sweepSpeed: optionTypes.sweepSpeed.default,
  persistence: optionTypes.persistence.default,
  beamWidth: optionTypes.beamWidth.default,
  clutterMode: optionTypes.clutterMode.default as ClutterMode,
  clutter: optionTypes.clutter.default,
  clutterRange: optionTypes.clutterRange.default,
  clutterBoil: optionTypes.clutterBoil.default,
  rings: optionTypes.rings.default,
  spokes: optionTypes.spokes.default,
  graticule: optionTypes.graticule.default,
  scopeScale: optionTypes.scopeScale.default,
  phosphor: optionTypes.phosphor.default as number[],
  background: optionTypes.background.default as number[],
};

type RadarPpiOptions = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

let _prog: Program | null = null;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source",
    "u_res",
    "u_sweep",
    "u_tau",
    "u_beam",
    "u_gain",
    "u_stc",
    "u_clutter",
    "u_clutterRange",
    "u_clutterMode",
    "u_clutterSeed",
    "u_rings",
    "u_spokes",
    "u_graticule",
    "u_scope",
    "u_phosphor",
    "u_background",
  ] as const);
  return _prog;
};

const radarPpi = (input: any, options: RadarPpiOptions = defaults) => {
  const W = input.width,
    H = input.height;
  if (!glAvailable()) return glUnavailableStub(W, H);

  const gain = normalizeRangeOption(options.gain, defaults.gain, 0, 6);
  const stc = normalizeRangeOption(options.stc, defaults.stc, 0, 1);
  const sweepSpeed = normalizeRangeOption(options.sweepSpeed, defaults.sweepSpeed, 0, 45);
  const persistence = normalizeRangeOption(options.persistence, defaults.persistence, 2, 360);
  const beamWidth = normalizeRangeOption(options.beamWidth, defaults.beamWidth, 0.2, 30);
  const clutterMode = normalizeEnumOption(
    options.clutterMode,
    CLUTTER_VALUES,
    defaults.clutterMode,
  );
  const clutter = normalizeRangeOption(options.clutter, defaults.clutter, 0, 2);
  const clutterRange = normalizeRangeOption(options.clutterRange, defaults.clutterRange, 0.02, 1);
  const clutterBoil = normalizeBooleanOption(options.clutterBoil, defaults.clutterBoil);
  const rings = normalizeRangeOption(options.rings, defaults.rings, 0, 12, true);
  const spokes = normalizeRangeOption(options.spokes, defaults.spokes, 0, 36, true);
  const graticule = normalizeRangeOption(options.graticule, defaults.graticule, 0, 1);
  const scopeScale = normalizeRangeOption(options.scopeScale, defaults.scopeScale, 0.2, 1.4);
  const phosphor = normalizeColorOption(options.phosphor, defaults.phosphor);
  const background = normalizeColorOption(options.background, defaults.background);
  const frameIndex = normalizeRangeOption(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER, true);

  const sweep = sweepBearing(frameIndex, sweepSpeed);

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "radarPpi:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  drawPass(
    gl,
    null,
    W,
    H,
    prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.uniform2f(prog.uniforms.u_res, W, H);
      gl.uniform1f(prog.uniforms.u_sweep, sweep);
      gl.uniform1f(prog.uniforms.u_tau, persistence * DEG);
      gl.uniform1f(prog.uniforms.u_beam, beamWidth * DEG);
      gl.uniform1f(prog.uniforms.u_gain, gain);
      gl.uniform1f(prog.uniforms.u_stc, stc);
      gl.uniform1f(prog.uniforms.u_clutter, clutter);
      gl.uniform1f(prog.uniforms.u_clutterRange, clutterRange);
      gl.uniform1i(prog.uniforms.u_clutterMode, clutterId[clutterMode] ?? 1);
      gl.uniform1f(prog.uniforms.u_clutterSeed, clutterBoil ? frameIndex % 512 : 0);
      gl.uniform1f(prog.uniforms.u_rings, rings);
      gl.uniform1f(prog.uniforms.u_spokes, spokes);
      gl.uniform1f(prog.uniforms.u_graticule, graticule);
      gl.uniform1f(prog.uniforms.u_scope, scopeScale);
      gl.uniform3f(prog.uniforms.u_phosphor, phosphor[0]!, phosphor[1]!, phosphor[2]!);
      gl.uniform3f(prog.uniforms.u_background, background[0]!, background[1]!, background[2]!);
    },
    vao,
  );

  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend(
    "Radar PPI",
    "WebGL2",
    `bearing=${(sweep / DEG).toFixed(1)}° tau=${persistence}°`,
  );
  return output;
};

export default defineFilter({
  name: "Radar PPI",
  func: radarPpi,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Rotating plan-position-indicator scope — 1/r⁴ radar-equation falloff with STC, exponential phosphor persistence behind the sweep, short-range sea and rain clutter, range rings and bearing graticule. There is no radar data: image luminance stands in for target reflectivity",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
