import { BOOL, COLOR, RANGE } from "../constants/controlTypes";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { rimDirection } from "./animeProductionContracts";
import { defineFilter, type FilterCanvas } from "./types";

const fragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform vec2 u_direction;
uniform float u_width;
uniform float u_threshold;
uniform float u_intensity;
uniform float u_halo;
uniform vec3 u_color;
uniform bool u_protectHighlights;

in vec2 v_uv;
out vec4 outColor;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float colorDistance(vec3 a, vec3 b) {
  vec3 delta = a - b;
  return sqrt(dot(delta, delta) / 3.0);
}

void main() {
  vec4 source = texture(u_source, v_uv);
  vec2 pixel = 1.0 / u_res;
  vec2 stepVector = u_direction * pixel * max(1.0, u_width);
  vec3 toward = texture(u_source, clamp(v_uv + stepVector, pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb;
  vec3 away = texture(u_source, clamp(v_uv - stepVector, pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb;

  float forwardEdge = colorDistance(source.rgb, toward);
  float reverseEdge = colorDistance(source.rgb, away);
  float directional = max(0.0, forwardEdge - reverseEdge * 0.45);
  float fineRim = smoothstep(u_threshold, u_threshold + 0.18, directional);

  vec2 haloStep = u_direction * pixel * max(2.0, u_width * 2.35);
  vec3 haloSample = texture(u_source, clamp(v_uv + haloStep, pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb;
  float broadEdge = smoothstep(u_threshold * 0.55, u_threshold + 0.2, colorDistance(source.rgb, haloSample));
  float rim = max(fineRim, broadEdge * u_halo * (1.0 - fineRim * 0.35));
  float highlightGuard = u_protectHighlights ? 1.0 - smoothstep(0.76, 1.0, luma(source.rgb)) * 0.75 : 1.0;
  float strength = rim * u_intensity * highlightGuard;

  vec3 screenLight = 1.0 - (1.0 - source.rgb) * (1.0 - u_color * strength);
  vec3 graded = mix(source.rgb, screenLight, min(1.0, strength * 1.18));
  outColor = vec4(graded, source.a);
}`;

export const optionTypes = {
  angle: { type: RANGE, range: [-180, 180], step: 1, default: -38, desc: "Direction the colored contour light arrives from" },
  width: { type: RANGE, range: [1, 12], step: 0.5, default: 3, desc: "Distance used to find the lit side of silhouettes" },
  threshold: { type: RANGE, range: [0.01, 0.4], step: 0.01, default: 0.14, desc: "Minimum directional color contrast that receives rim light" },
  intensity: { type: RANGE, range: [0, 2], step: 0.05, default: 0.5, desc: "Brightness of the colored contour light" },
  halo: { type: RANGE, range: [0, 1], step: 0.05, default: 0.26, desc: "Amount of broader glow surrounding the narrow rim" },
  color: { type: COLOR, default: [113, 221, 255], desc: "Color of the composited rim and halo" },
  protectHighlights: { type: BOOL, default: true, desc: "Reduce the effect over highlights that are already near white" },
};

export const defaults = {
  angle: optionTypes.angle.default,
  width: optionTypes.width.default,
  threshold: optionTypes.threshold.default,
  intensity: optionTypes.intensity.default,
  halo: optionTypes.halo.default,
  color: optionTypes.color.default,
  protectHighlights: optionTypes.protectHighlights.default,
};

const animeRimLight = (input: FilterCanvas, options = defaults) => {
  const resolved = { ...defaults, ...options };
  const direction = rimDirection(resolved.angle);
  const color = resolved.color as [number, number, number];
  const output = renderGLSinglePass({
    source: input,
    width: input.width,
    height: input.height,
    key: "anime-rim-light-v1",
    fragmentShader,
    uniformNames: [
      "u_direction", "u_width", "u_threshold", "u_intensity", "u_halo",
      "u_color", "u_protectHighlights",
    ],
    setUniforms: (gl, uniforms) => {
      gl.uniform2f(uniforms.u_direction, direction.x, direction.y);
      gl.uniform1f(uniforms.u_width, resolved.width);
      gl.uniform1f(uniforms.u_threshold, resolved.threshold);
      gl.uniform1f(uniforms.u_intensity, resolved.intensity);
      gl.uniform1f(uniforms.u_halo, resolved.halo);
      gl.uniform3f(uniforms.u_color, color[0] / 255, color[1] / 255, color[2] / 255);
      gl.uniform1i(uniforms.u_protectHighlights, resolved.protectHighlights ? 1 : 0);
    },
  });
  if (output) logFilterBackend("Anime Rim Light", "WebGL2", `angle=${resolved.angle} width=${resolved.width}`);
  return output ?? input;
};

export default defineFilter({
  name: "Anime Rim Light",
  func: animeRimLight,
  optionTypes,
  options: defaults,
  defaults,
  description: "Directional colored contour light for anime-style compositing and dramatic scene accents",
  requiresGL: true,
});
