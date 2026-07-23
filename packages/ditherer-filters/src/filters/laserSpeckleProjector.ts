import { ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const LASER = { RGB: "RGB", RED: "RED", GREEN: "GREEN", BLUE: "BLUE" } as const;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_laser;
uniform float u_grain;
uniform float u_coherence;
uniform int u_diversity;
uniform float u_scanPitch;
uniform float u_scanStrength;
uniform float u_bloom;
uniform float u_time;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  vec3 low = c * 12.92;
  vec3 high = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, cutoff);
}

float coherentIntensity(vec2 p, float seed) {
  vec2 amplitude = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float angle = 6.2831853 * hash(seed * 17.13 + fi * 9.71);
    vec2 direction = vec2(cos(angle), sin(angle));
    float frequency = mix(0.45, 1.45, hash(seed * 5.91 + fi * 3.17));
    float phase = dot(p, direction) * frequency
      + hash(seed * 31.7 + fi * 11.9) * 6.2831853;
    amplitude += vec2(cos(phase), sin(phase));
  }
  return dot(amplitude, amplitude) / 6.0;
}

float averagedSpeckle(vec2 p, float channelSeed) {
  float intensity = 0.0;
  for (int mode = 0; mode < 8; mode++) {
    if (mode >= u_diversity) break;
    float seed = channelSeed + float(mode) * 19.37 + u_time * (0.7 + float(mode) * 0.09);
    intensity += coherentIntensity(p + vec2(hash(seed), hash(seed + 2.0)) * 8.0, seed);
  }
  return intensity / float(max(u_diversity, 1));
}

void main() {
  vec2 texel = 1.0 / max(u_res, vec2(1.0));
  vec4 sourceSample = texture(u_source, v_uv);
  vec3 source = srgbToLinear(sourceSample.rgb);
  vec3 soft = source * 0.42;
  soft += srgbToLinear(texture(u_source, v_uv + vec2(texel.x * 2.0, 0.0)).rgb) * 0.145;
  soft += srgbToLinear(texture(u_source, v_uv - vec2(texel.x * 2.0, 0.0)).rgb) * 0.145;
  soft += srgbToLinear(texture(u_source, v_uv + vec2(0.0, texel.y * 2.0)).rgb) * 0.145;
  soft += srgbToLinear(texture(u_source, v_uv - vec2(0.0, texel.y * 2.0)).rgb) * 0.145;
  vec3 projected = mix(source, max(source, soft), u_bloom);

  float luma = dot(projected, vec3(0.2126, 0.7152, 0.0722));
  if (u_laser == 1) projected = vec3(luma, luma * 0.055, luma * 0.018);
  else if (u_laser == 2) projected = vec3(luma * 0.035, luma, luma * 0.09);
  else if (u_laser == 3) projected = vec3(luma * 0.025, luma * 0.11, luma);

  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 speckleCoord = pixel / max(u_grain, 0.5);
  vec3 intensity = vec3(
    averagedSpeckle(speckleCoord, 3.1),
    averagedSpeckle(speckleCoord * 1.013, 11.7),
    averagedSpeckle(speckleCoord * 1.027, 23.9)
  );
  intensity = clamp(intensity, vec3(0.0), vec3(4.0));
  vec3 granular = projected * mix(vec3(1.0), intensity, u_coherence);
  float scan = sin(pixel.y / max(u_scanPitch, 1.0) * 6.2831853 + u_time * 2.0);
  granular *= 1.0 + scan * clamp(u_scanStrength, 0.0, 1.0) * 0.18;
  fragColor = vec4(clamp(linearToSrgb(granular), 0.0, 1.0), sourceSample.a);
}`;

export const optionTypes = {
  laser: {
    type: ENUM,
    options: [
      { name: "RGB laser", value: LASER.RGB },
      { name: "638 nm red", value: LASER.RED },
      { name: "520 nm green", value: LASER.GREEN },
      { name: "450 nm blue", value: LASER.BLUE },
    ],
    default: LASER.RGB,
    desc: "Laser-primary configuration used to project the source",
  },
  grain: { type: RANGE, range: [0.5, 16], step: 0.5, default: 4.5, desc: "Apparent coherent speckle grain diameter in pixels" },
  coherence: { type: RANGE, range: [0, 1], step: 0.01, default: 0.46, desc: "Single-pattern speckle contrast mixed into the projected irradiance" },
  diversity: { type: RANGE, range: [1, 8], step: 1, default: 4, desc: "Independent equal-power patterns averaged so contrast falls approximately as 1/√M" },
  scanPitch: { type: RANGE, range: [1, 24], step: 1, default: 7, desc: "Spacing of the projector scan and pulse-width modulation structure" },
  scanStrength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.18, desc: "Visibility of scan and pulse-width modulation bands" },
  bloom: { type: RANGE, range: [0, 1], step: 0.01, default: 0.28, desc: "Optical flare around bright projected detail" },
  motion: { type: RANGE, range: [0, 2], step: 0.02, default: 0.32, desc: "Rate at which changing diffuser phases animate the speckle" },
};

export const defaults = {
  laser: optionTypes.laser.default,
  grain: optionTypes.grain.default,
  coherence: optionTypes.coherence.default,
  diversity: optionTypes.diversity.default,
  scanPitch: optionTypes.scanPitch.default,
  scanStrength: optionTypes.scanStrength.default,
  bloom: optionTypes.bloom.default,
  motion: optionTypes.motion.default,
};

const laserId: Record<string, number> = { RGB: 0, RED: 1, GREEN: 2, BLUE: 3 };

const boundedOption = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

const laserSpeckleProjector = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width, H = input.height;
  const grain = boundedOption(options.grain, defaults.grain, 0.5, 16);
  const coherence = boundedOption(options.coherence, defaults.coherence, 0, 1);
  const diversity = Math.round(boundedOption(options.diversity, defaults.diversity, 1, 8));
  const scanPitch = boundedOption(options.scanPitch, defaults.scanPitch, 1, 24);
  const scanStrength = boundedOption(options.scanStrength, defaults.scanStrength, 0, 1);
  const bloom = boundedOption(options.bloom, defaults.bloom, 0, 1);
  const motion = boundedOption(options.motion, defaults.motion, 0, 2);
  const frameIndex = boundedOption(runtime._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER);
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "laserSpeckleProjector", fragmentShader: FS,
    uniformNames: ["u_laser", "u_grain", "u_coherence", "u_diversity", "u_scanPitch", "u_scanStrength", "u_bloom", "u_time"],
    setUniforms: (gl, u) => {
      gl.uniform1i(u.u_laser, laserId[String(options.laser)] ?? 0);
      gl.uniform1f(u.u_grain, grain);
      gl.uniform1f(u.u_coherence, coherence);
      gl.uniform1i(u.u_diversity, diversity);
      gl.uniform1f(u.u_scanPitch, scanPitch);
      gl.uniform1f(u.u_scanStrength, scanStrength);
      gl.uniform1f(u.u_bloom, bloom);
      gl.uniform1f(u.u_time, frameIndex * motion * 0.04);
    },
  });
  if (!rendered) return input;
  logFilterBackend("Laser Speckle Projector", "WebGL2", `${options.laser} M=${diversity}`);
  return rendered;
};

export default defineFilter({
  name: "Laser Speckle Projector",
  func: laserSpeckleProjector,
  optionTypes,
  options: defaults,
  defaults,
  description: "Linear-light laser-projector irradiance with coherent speckle, independent-pattern diversity, scan structure, and optical bloom",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
