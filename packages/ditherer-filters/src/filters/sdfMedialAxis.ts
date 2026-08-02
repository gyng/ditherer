import { COLOR, RANGE } from "../constants/controlTypes";
import { logFilterBackend } from "../utils/index";
import { renderSdfEffect, SDF_GLSL } from "../utils/sdfJumpFlood";
import { defineFilter } from "./types";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_sdf;
uniform vec2 u_res;
uniform float u_threshold;
uniform float u_minRadius;
uniform float u_probeRadius;
uniform float u_sensitivity;
uniform float u_glow;
uniform float u_sourceMix;
uniform vec3 u_axisColor;
uniform vec3 u_backgroundColor;

${SDF_GLSL}

void main() {
  ivec2 p = ivec2(floor(v_uv * u_res));
  float distanceHere = signedDistanceAt(u_sdf, u_source, p, u_res, u_threshold);
  float radius = max(0.0, -distanceHere);
  vec4 centerFeature = texelFetch(u_sdf, p, 0);
  float separation = 0.0;
  int probe = int(max(1.0, floor(u_probeRadius + 0.5)));
  const ivec2 directions[8] = ivec2[8](
    ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1),
    ivec2(-1, -1), ivec2(1, -1), ivec2(-1, 1), ivec2(1, 1)
  );
  for (int i = 0; i < 8; i++) {
    ivec2 q = clamp(p + directions[i] * probe, ivec2(0), ivec2(u_res) - 1);
    vec4 feature = texelFetch(u_sdf, q, 0);
    if (centerFeature.x >= 0.0 && feature.x >= 0.0) {
      separation = max(separation, length((feature.rg - centerFeature.rg) * u_res));
    }
  }

  float competition = separation / max(2.0 * radius, 1.0);
  float axis = smoothstep(u_sensitivity - 0.12, u_sensitivity + 0.12, competition);
  axis *= smoothstep(u_minRadius - 1.0, u_minRadius + 1.0, radius);
  axis *= distanceHere < 0.0 ? 1.0 : 0.0;
  float halo = smoothstep(u_sensitivity * 0.35, u_sensitivity, competition)
    * smoothstep(u_minRadius - 2.0, u_minRadius + 1.0, radius)
    * (distanceHere < 0.0 ? 1.0 : 0.0);

  vec3 sourceColor = texelFetch(u_source, p, 0).rgb;
  vec3 background = mix(u_backgroundColor / 255.0, sourceColor, u_sourceMix);
  float radiusTone = 0.55 + 0.45 * (1.0 - exp(-radius / 28.0));
  vec3 filament = u_axisColor / 255.0 * radiusTone;
  vec3 color = background + filament * halo * u_glow * 0.45;
  color = mix(color, filament, axis);
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export const optionTypes = {
  threshold: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Luminance threshold defining the silhouette",
  },
  minRadius: {
    type: RANGE,
    range: [0, 80],
    step: 1,
    default: 5,
    desc: "Prune skeleton branches thinner than this local radius",
  },
  probeRadius: {
    type: RANGE,
    range: [1, 8],
    step: 1,
    default: 2,
    desc: "Neighborhood radius used to find competing boundary sites",
  },
  sensitivity: {
    type: RANGE,
    range: [0.2, 1.4],
    step: 0.05,
    default: 0.68,
    desc: "Required divergence between nearest-boundary sites",
  },
  glow: {
    type: RANGE,
    range: [0, 4],
    step: 0.1,
    default: 1.4,
    desc: "Light emitted around medial-axis filaments",
  },
  sourceMix: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.18,
    desc: "Amount of original image retained behind the skeleton",
  },
  axisColor: { type: COLOR, default: [100, 232, 255], desc: "Medial-axis filament color" },
  backgroundColor: {
    type: COLOR,
    default: [8, 12, 22],
    desc: "Background color behind the field skeleton",
  },
};

export const defaults = Object.fromEntries(
  Object.entries(optionTypes).map(([key, option]) => [key, option.default]),
) as { [K in keyof typeof optionTypes]: (typeof optionTypes)[K]["default"] };

const sdfMedialAxis = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const rendered = renderSdfEffect({
    source: input,
    width: input.width,
    height: input.height,
    key: "sdfMedialAxis",
    threshold: options.threshold,
    fragmentShader: FS,
    uniformNames: [
      "u_minRadius",
      "u_probeRadius",
      "u_sensitivity",
      "u_glow",
      "u_sourceMix",
      "u_axisColor",
      "u_backgroundColor",
    ],
    setUniforms: (gl, uniforms) => {
      gl.uniform1f(uniforms.u_minRadius, options.minRadius);
      gl.uniform1f(uniforms.u_probeRadius, options.probeRadius);
      gl.uniform1f(uniforms.u_sensitivity, options.sensitivity);
      gl.uniform1f(uniforms.u_glow, options.glow);
      gl.uniform1f(uniforms.u_sourceMix, options.sourceMix);
      gl.uniform3f(
        uniforms.u_axisColor,
        options.axisColor[0],
        options.axisColor[1],
        options.axisColor[2],
      );
      gl.uniform3f(
        uniforms.u_backgroundColor,
        options.backgroundColor[0],
        options.backgroundColor[1],
        options.backgroundColor[2],
      );
    },
  });
  if (!rendered) return input;
  logFilterBackend("SDF Medial Axis", "WebGL2", `radius>=${options.minRadius}`);
  return rendered;
};

export default defineFilter({
  name: "SDF Medial Axis",
  func: sdfMedialAxis,
  optionTypes,
  options: defaults,
  defaults,
  description: "Reveal a silhouette's topological skeleton where nearest-boundary regions meet",
  requiresGL: true,
});
