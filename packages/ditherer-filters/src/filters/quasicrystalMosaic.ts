import { COLOR, ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const SYMMETRY = { FIVE: 5, SEVEN: 7, EIGHT: 8, TEN: 10 } as const;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_order;
uniform float u_scale;
uniform float u_rotation;
uniform float u_sourceInfluence;
uniform float u_facets;
uniform float u_bevel;
uniform float u_sourceMix;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_high;

float waveField(vec2 pixel, float sourceLuma) {
  float sum = 0.0;
  float frequency = 6.2831853 / max(u_scale, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= u_order) break;
    float angle = u_rotation + float(i) * 6.2831853 / float(u_order);
    vec2 direction = vec2(cos(angle), sin(angle));
    float phase = dot(pixel, direction) * frequency
      + sourceLuma * u_sourceInfluence * 6.2831853
      + sin(float(i) * 2.17) * 0.35;
    sum += cos(phase);
  }
  return sum / float(max(u_order, 1));
}

void main() {
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y) - u_res * 0.5;
  vec3 source = texture(u_source, v_uv).rgb;
  float luma = dot(source, vec3(0.2126, 0.7152, 0.0722));
  float field = waveField(pixel, luma);
  float energy = clamp(abs(field) * 1.85, 0.0, 1.0);
  float levels = max(u_facets - 1.0, 1.0);
  float terraced = floor(energy * levels + 0.5) / levels;

  float dx = waveField(pixel + vec2(1.5, 0.0), luma) - waveField(pixel - vec2(1.5, 0.0), luma);
  float dy = waveField(pixel + vec2(0.0, 1.5), luma) - waveField(pixel - vec2(0.0, 1.5), luma);
  vec3 normal = normalize(vec3(-dx * u_bevel, -dy * u_bevel, 0.55));
  vec3 light = normalize(vec3(-0.45, 0.65, 0.8));
  float shade = 0.7 + max(dot(normal, light), 0.0) * 0.5;
  float terracePhase = fract(energy * levels + 0.5);
  float boundaryDistance = min(terracePhase, 1.0 - terracePhase);
  float boundary = 1.0 - smoothstep(0.0, 0.035, boundaryDistance);

  vec3 mosaic = terraced < 0.5
    ? mix(u_low / 255.0, u_mid / 255.0, terraced * 2.0)
    : mix(u_mid / 255.0, u_high / 255.0, (terraced - 0.5) * 2.0);
  mosaic *= shade;
  mosaic = mix(mosaic, u_high / 255.0, boundary * 0.16 * u_bevel);
  mosaic = mix(mosaic, mosaic * (0.55 + source * 0.75), u_sourceMix);
  fragColor = vec4(clamp(mosaic, 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  symmetry: {
    type: ENUM,
    options: [
      { name: "Five-fold", value: SYMMETRY.FIVE },
      { name: "Seven-fold", value: SYMMETRY.SEVEN },
      { name: "Eight-fold", value: SYMMETRY.EIGHT },
      { name: "Ten-fold", value: SYMMETRY.TEN },
    ],
    default: SYMMETRY.EIGHT,
    desc: "Forbidden rotational order of the aperiodic interference field",
  },
  scale: {
    type: RANGE,
    range: [5, 100],
    step: 1,
    default: 29,
    desc: "Wavelength of the interfering plane waves in pixels",
  },
  rotation: {
    type: RANGE,
    range: [-180, 180],
    step: 1,
    default: 0,
    desc: "Rotation of the wave-vector constellation",
  },
  sourceInfluence: {
    type: RANGE,
    range: [0, 3],
    step: 0.02,
    default: 0.7,
    desc: "Source-luminance phase modulation of the aperiodic field",
  },
  facets: {
    type: RANGE,
    range: [2, 12],
    step: 1,
    default: 6,
    desc: "Number of terraced material levels",
  },
  bevel: {
    type: RANGE,
    range: [0, 5],
    step: 0.05,
    default: 1.8,
    desc: "Directional relief shading across interference facets",
  },
  sourceMix: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.34,
    desc: "Amount of source color embedded in the mosaic material",
  },
  low: { type: COLOR, default: [13, 19, 38], desc: "Color of low interference-energy facets" },
  mid: { type: COLOR, default: [23, 158, 158], desc: "Color of middle interference-energy facets" },
  high: {
    type: COLOR,
    default: [244, 190, 72],
    desc: "Color of high interference-energy facets and ridges",
  },
};

export const defaults = {
  symmetry: optionTypes.symmetry.default,
  scale: optionTypes.scale.default,
  rotation: optionTypes.rotation.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  facets: optionTypes.facets.default,
  bevel: optionTypes.bevel.default,
  sourceMix: optionTypes.sourceMix.default,
  low: optionTypes.low.default,
  mid: optionTypes.mid.default,
  high: optionTypes.high.default,
};

const quasicrystalMosaic = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "quasicrystalMosaic",
    fragmentShader: FS,
    uniformNames: [
      "u_order",
      "u_scale",
      "u_rotation",
      "u_sourceInfluence",
      "u_facets",
      "u_bevel",
      "u_sourceMix",
      "u_low",
      "u_mid",
      "u_high",
    ],
    setUniforms: (gl, u) => {
      gl.uniform1i(u.u_order, Number(options.symmetry));
      gl.uniform1f(u.u_scale, Number(options.scale));
      gl.uniform1f(u.u_rotation, (Number(options.rotation) * Math.PI) / 180);
      gl.uniform1f(u.u_sourceInfluence, Number(options.sourceInfluence));
      gl.uniform1f(u.u_facets, Number(options.facets));
      gl.uniform1f(u.u_bevel, Number(options.bevel));
      gl.uniform1f(u.u_sourceMix, Number(options.sourceMix));
      gl.uniform3f(u.u_low, options.low[0]!, options.low[1]!, options.low[2]!);
      gl.uniform3f(u.u_mid, options.mid[0]!, options.mid[1]!, options.mid[2]!);
      gl.uniform3f(u.u_high, options.high[0]!, options.high[1]!, options.high[2]!);
    },
  });
  if (!rendered) return input;
  logFilterBackend(
    "Quasicrystal Mosaic",
    "WebGL2",
    `${options.symmetry}-fold scale=${options.scale}`,
  );
  return rendered;
};

export default defineFilter({
  name: "Quasicrystal Mosaic",
  func: quasicrystalMosaic,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Aperiodic interference facets with forbidden rotational symmetry, source-modulated phase, and relief shading",
  requiresGL: true,
});
