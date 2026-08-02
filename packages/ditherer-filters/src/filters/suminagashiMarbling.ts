import { COLOR, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_ringSpacing;
uniform float u_drops;
uniform float u_flowStrength;
uniform float u_combScale;
uniform float u_combStrength;
uniform float u_inkDensity;
uniform float u_sourceMix;
uniform float u_paperGrain;
uniform float u_time;
uniform vec3 u_inkA;
uniform vec3 u_inkB;
uniform vec3 u_paper;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float lum(vec2 uv) {
  return dot(texture(u_source, clamp(uv, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 texel = 1.0 / max(u_res, vec2(1.0));
  float gx = lum(v_uv + vec2(texel.x * 2.0, 0.0)) - lum(v_uv - vec2(texel.x * 2.0, 0.0));
  float gy = lum(v_uv + vec2(0.0, texel.y * 2.0)) - lum(v_uv - vec2(0.0, texel.y * 2.0));
  vec2 tangent = vec2(-gy, gx);
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 advected = pixel + tangent * u_flowStrength;
  advected.x += sin(advected.y / max(u_combScale, 1.0) * 6.2831853 + u_time) * u_combStrength;
  advected.y += sin(advected.x / max(u_combScale * 1.7, 1.0) * 6.2831853 - u_time * 0.6) * u_combStrength * 0.28;

  float field = 0.0;
  float weight = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= u_drops) break;
    float fi = float(i);
    vec2 center = u_res * vec2(
      0.18 + 0.64 * hash(vec2(fi + 2.7, 5.1)),
      0.16 + 0.68 * hash(vec2(fi + 8.4, 1.9))
    );
    vec2 delta = advected - center;
    float radius = length(delta);
    float angle = atan(delta.y, delta.x);
    float wobble = sin(angle * (3.0 + fi) + u_time * (0.4 + fi * 0.08)) * u_ringSpacing * 0.22;
    float phase = (radius + wobble) / max(u_ringSpacing, 1.0) * 6.2831853 + fi * 1.73;
    float ring = 1.0 - smoothstep(0.06, 0.52, abs(sin(phase)));
    float fade = 1.0 - smoothstep(0.0, max(u_res.x, u_res.y) * 1.05, radius);
    field += ring * fade;
    weight += (0.5 + 0.5 * sin(phase * 0.5 + fi * 2.1)) * ring * fade;
  }

  float ink = clamp(field * u_inkDensity, 0.0, 1.0);
  float split = clamp(weight / max(field, 0.0001), 0.0, 1.0);
  float fiber = noise(pixel * vec2(0.11, 0.55)) * 0.65 + noise(pixel * vec2(0.7, 0.08)) * 0.35;
  vec3 paper = u_paper / 255.0 * mix(1.0 - u_paperGrain * 0.18, 1.0 + u_paperGrain * 0.09, fiber);
  vec3 inkColor = mix(u_inkA / 255.0, u_inkB / 255.0, split);
  vec3 marbled = mix(paper, inkColor, ink);
  vec3 source = texture(u_source, v_uv).rgb;
  vec3 sourceGlaze = marbled * mix(vec3(0.55), source * 1.15 + 0.2, 0.7);
  fragColor = vec4(clamp(mix(marbled, sourceGlaze, u_sourceMix), 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  ringSpacing: {
    type: RANGE,
    range: [3, 48],
    step: 1,
    default: 18,
    desc: "Spacing between successive floating-ink rings",
  },
  drops: {
    type: RANGE,
    range: [1, 5],
    step: 1,
    default: 3,
    desc: "Number of overlapping ink-drop centers",
  },
  flowStrength: {
    type: RANGE,
    range: [0, 80],
    step: 1,
    default: 22,
    desc: "Advection along the source-luminance contour flow",
  },
  combScale: {
    type: RANGE,
    range: [8, 120],
    step: 1,
    default: 46,
    desc: "Spacing of the combed wave deformation",
  },
  combStrength: {
    type: RANGE,
    range: [0, 40],
    step: 1,
    default: 10,
    desc: "Distance the comb pulls the floating ink",
  },
  inkDensity: {
    type: RANGE,
    range: [0, 2],
    step: 0.02,
    default: 1.02,
    desc: "Opacity and overlap of deposited ink rings",
  },
  sourceMix: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.27,
    desc: "Amount of source color glazed through the marbling",
  },
  paperGrain: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.38,
    desc: "Cross-grain variation in the absorbent paper",
  },
  motion: {
    type: RANGE,
    range: [0, 2],
    step: 0.02,
    default: 0.18,
    desc: "Slow drift of floating rings before transfer",
  },
  inkA: { type: COLOR, default: [16, 30, 52], desc: "Primary floating ink color" },
  inkB: { type: COLOR, default: [166, 42, 54], desc: "Secondary floating ink color" },
  paper: { type: COLOR, default: [238, 226, 198], desc: "Absorbent paper color" },
};

export const defaults = {
  ringSpacing: optionTypes.ringSpacing.default,
  drops: optionTypes.drops.default,
  flowStrength: optionTypes.flowStrength.default,
  combScale: optionTypes.combScale.default,
  combStrength: optionTypes.combStrength.default,
  inkDensity: optionTypes.inkDensity.default,
  sourceMix: optionTypes.sourceMix.default,
  paperGrain: optionTypes.paperGrain.default,
  motion: optionTypes.motion.default,
  inkA: optionTypes.inkA.default,
  inkB: optionTypes.inkB.default,
  paper: optionTypes.paper.default,
};

const suminagashiMarbling = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "suminagashiMarbling",
    fragmentShader: FS,
    uniformNames: [
      "u_ringSpacing",
      "u_drops",
      "u_flowStrength",
      "u_combScale",
      "u_combStrength",
      "u_inkDensity",
      "u_sourceMix",
      "u_paperGrain",
      "u_time",
      "u_inkA",
      "u_inkB",
      "u_paper",
    ],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_ringSpacing, Number(options.ringSpacing));
      gl.uniform1f(u.u_drops, Number(options.drops));
      gl.uniform1f(u.u_flowStrength, Number(options.flowStrength));
      gl.uniform1f(u.u_combScale, Number(options.combScale));
      gl.uniform1f(u.u_combStrength, Number(options.combStrength));
      gl.uniform1f(u.u_inkDensity, Number(options.inkDensity));
      gl.uniform1f(u.u_sourceMix, Number(options.sourceMix));
      gl.uniform1f(u.u_paperGrain, Number(options.paperGrain));
      gl.uniform1f(u.u_time, Number(runtime._frameIndex ?? 0) * Number(options.motion) * 0.025);
      gl.uniform3f(u.u_inkA, options.inkA[0]!, options.inkA[1]!, options.inkA[2]!);
      gl.uniform3f(u.u_inkB, options.inkB[0]!, options.inkB[1]!, options.inkB[2]!);
      gl.uniform3f(u.u_paper, options.paper[0]!, options.paper[1]!, options.paper[2]!);
    },
  });
  if (!rendered) return input;
  logFilterBackend(
    "Suminagashi Marbling",
    "WebGL2",
    `${options.drops} drops spacing=${options.ringSpacing}`,
  );
  return rendered;
};

export default defineFilter({
  name: "Suminagashi Marbling",
  func: suminagashiMarbling,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Floating ink rings combed through a source-derived contour flow and transferred onto fibrous paper",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 24,
  requiresGL: true,
});
