import { ENUM, RANGE } from "../constants/controlTypes";
import { logFilterBackend } from "../utils/index";
import { renderSdfEffect, SDF_GLSL } from "../utils/sdfJumpFlood";
import { defineFilter } from "./types";

const MODE = { NORMAL: "NORMAL", TANGENT: "TANGENT", VORTEX: "VORTEX" };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_sdf;
uniform vec2 u_res;
uniform float u_threshold;
uniform int u_mode;
uniform float u_strength;
uniform float u_frequency;
uniform float u_edgeRange;
uniform float u_twist;
uniform float u_phase;

${SDF_GLSL}

void main() {
  ivec2 p = ivec2(floor(v_uv * u_res));
  float center = signedDistanceAt(u_sdf, u_source, p, u_res, u_threshold);
  float left = signedDistanceAt(u_sdf, u_source, p + ivec2(-1, 0), u_res, u_threshold);
  float right = signedDistanceAt(u_sdf, u_source, p + ivec2(1, 0), u_res, u_threshold);
  float down = signedDistanceAt(u_sdf, u_source, p + ivec2(0, -1), u_res, u_threshold);
  float up = signedDistanceAt(u_sdf, u_source, p + ivec2(0, 1), u_res, u_threshold);
  vec2 normal = normalize(vec2(right - left, up - down) + vec2(1e-5, 0.0));
  vec2 tangent = vec2(-normal.y, normal.x);

  float phase = center / max(1.0, u_frequency) * 6.2831853 + u_phase;
  float wave = sin(phase);
  vec2 direction;
  if (u_mode == 0) direction = normal * wave;
  else if (u_mode == 1) direction = tangent * wave;
  else direction = normalize(tangent + normal * sin(phase * u_twist));
  float envelope = exp(-abs(center) / max(1.0, u_edgeRange));
  vec2 samplePixel = vec2(p) + 0.5 + direction * u_strength * envelope;
  vec2 sampleUv = clamp(samplePixel / u_res, vec2(0.0), vec2(1.0));
  fragColor = vec4(texture(u_source, sampleUv).rgb, 1.0);
}
`;

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Normal ripples", value: MODE.NORMAL },
      { name: "Contour flow", value: MODE.TANGENT },
      { name: "Vortex weave", value: MODE.VORTEX },
    ],
    default: MODE.TANGENT,
    desc: "Vector direction derived from the signed-distance gradient",
  },
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Luminance threshold defining the guiding silhouette" },
  strength: { type: RANGE, range: [-120, 120], step: 1, default: 20, desc: "Signed displacement distance in pixels" },
  frequency: { type: RANGE, range: [2, 120], step: 1, default: 24, desc: "Spacing of waves across signed-distance levels" },
  edgeRange: { type: RANGE, range: [2, 400], step: 2, default: 120, desc: "Distance over which the boundary vector field remains influential" },
  twist: { type: RANGE, range: [0.25, 6], step: 0.25, default: 2, desc: "Normal-to-tangent weaving frequency in vortex mode" },
  animateSpeed: { type: RANGE, range: [0, 4], step: 0.05, default: 0.6, desc: "Speed at which field waves travel" },
};

export const defaults = Object.fromEntries(
  Object.entries(optionTypes).map(([key, option]) => [key, option.default]),
) as { [K in keyof typeof optionTypes]: (typeof optionTypes)[K]["default"] };

const MODE_ID: Record<string, number> = { NORMAL: 0, TANGENT: 1, VORTEX: 2 };

const sdfFlowWarp = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const rendered = renderSdfEffect({
    source: input,
    width: input.width,
    height: input.height,
    key: "sdfFlowWarp",
    threshold: options.threshold,
    fragmentShader: FS,
    uniformNames: ["u_mode", "u_strength", "u_frequency", "u_edgeRange", "u_twist", "u_phase"],
    setUniforms: (gl, uniforms) => {
      gl.uniform1i(uniforms.u_mode, MODE_ID[options.mode] ?? 0);
      gl.uniform1f(uniforms.u_strength, options.strength);
      gl.uniform1f(uniforms.u_frequency, options.frequency);
      gl.uniform1f(uniforms.u_edgeRange, options.edgeRange);
      gl.uniform1f(uniforms.u_twist, options.twist);
      gl.uniform1f(uniforms.u_phase, (runtime._frameIndex ?? 0) * options.animateSpeed * 0.055);
    },
  });
  if (!rendered) return input;
  logFilterBackend("SDF Flow Warp", "WebGL2", `${options.mode} strength=${options.strength}`);
  return rendered;
};

export default defineFilter({
  name: "SDF Flow Warp",
  func: sdfFlowWarp,
  optionTypes,
  options: defaults,
  defaults,
  description: "Warp the source along normals and tangents of its signed-distance silhouette",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
