import { COLOR, ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const MODE = { KNIFE: "KNIFE", COLOR: "COLOR", SHADOWGRAPH: "SHADOWGRAPH" } as const;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_angle;
uniform float u_radius;
uniform float u_sensitivity;
uniform float u_cutoff;
uniform float u_sourceMix;
uniform vec3 u_positive;
uniform vec3 u_negative;
uniform vec3 u_background;

float luminanceAt(vec2 uv) {
  return dot(texture(u_source, clamp(uv, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 texel = 1.0 / max(u_res, vec2(1.0));
  vec2 axis = vec2(cos(u_angle), sin(u_angle));
  vec2 stepUv = axis * texel * u_radius;
  vec2 slitUv = vec2(-axis.y, axis.x) * texel * u_radius * 0.7;
  float center = luminanceAt(v_uv);
  float positive = (luminanceAt(v_uv + stepUv)
    + luminanceAt(v_uv + stepUv + slitUv)
    + luminanceAt(v_uv + stepUv - slitUv)) / 3.0;
  float negative = (luminanceAt(v_uv - stepUv)
    + luminanceAt(v_uv - stepUv + slitUv)
    + luminanceAt(v_uv - stepUv - slitUv)) / 3.0;
  float response = (positive - negative) * 0.5 * u_sensitivity;
  vec3 source = texture(u_source, v_uv).rgb;
  vec3 result;

  if (u_mode == 0) {
    float light = clamp(u_cutoff + response, 0.0, 1.0);
    result = mix(u_background / 255.0, vec3(1.0), light);
  } else if (u_mode == 1) {
    float magnitude = clamp(abs(response), 0.0, 1.0);
    vec3 deflection = response >= 0.0 ? u_positive / 255.0 : u_negative / 255.0;
    result = mix(u_background / 255.0, deflection, magnitude);
    result += vec3(clamp(1.0 - magnitude * 2.2, 0.0, 0.22));
  } else {
    vec2 sx = vec2(texel.x * u_radius, 0.0);
    vec2 sy = vec2(0.0, texel.y * u_radius);
    float laplacian = luminanceAt(v_uv + sx) + luminanceAt(v_uv - sx)
      + luminanceAt(v_uv + sy) + luminanceAt(v_uv - sy) - 4.0 * center;
    float light = clamp(u_cutoff - laplacian * u_sensitivity, 0.0, 1.0);
    result = mix(u_background / 255.0, vec3(1.0), light);
  }

  fragColor = vec4(clamp(mix(result, source, u_sourceMix), 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Knife edge", value: MODE.KNIFE },
      { name: "Color schlieren", value: MODE.COLOR },
      { name: "Shadowgraph", value: MODE.SHADOWGRAPH },
    ],
    default: MODE.KNIFE,
    desc: "Optical readout used to convert refractive deflection into visible contrast",
  },
  knifeAngle: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Direction normal to the knife edge, in degrees" },
  radius: { type: RANGE, range: [1, 12], step: 1, default: 3, desc: "Separation used to measure the source-luminance gradient" },
  sensitivity: { type: RANGE, range: [0, 24], step: 0.25, default: 7.5, desc: "Brightness response to refractive deflection" },
  cutoff: { type: RANGE, range: [0, 1], step: 0.01, default: 0.42, desc: "Fraction of the focused source intercepted by the knife edge" },
  sourceMix: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Amount of original image retained beneath the optical readout" },
  positive: { type: COLOR, default: [255, 104, 36], desc: "Color assigned to positive ray deflection" },
  negative: { type: COLOR, default: [34, 156, 255], desc: "Color assigned to negative ray deflection" },
  background: { type: COLOR, default: [18, 20, 24], desc: "Un-deflected field color" },
};

export const defaults = Object.fromEntries(
  Object.entries(optionTypes).map(([key, option]) => [key, option.default]),
) as {
  mode: string; knifeAngle: number; radius: number; sensitivity: number; cutoff: number;
  sourceMix: number; positive: number[]; negative: number[]; background: number[];
};

const modeId: Record<string, number> = { KNIFE: 0, COLOR: 1, SHADOWGRAPH: 2 };

const schlierenOptics = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "schlierenOptics", fragmentShader: FS,
    uniformNames: ["u_mode", "u_angle", "u_radius", "u_sensitivity", "u_cutoff", "u_sourceMix", "u_positive", "u_negative", "u_background"],
    setUniforms: (gl, u) => {
      gl.uniform1i(u.u_mode, modeId[String(options.mode)] ?? 0);
      gl.uniform1f(u.u_angle, Number(options.knifeAngle) * Math.PI / 180);
      gl.uniform1f(u.u_radius, Number(options.radius));
      gl.uniform1f(u.u_sensitivity, Number(options.sensitivity));
      gl.uniform1f(u.u_cutoff, Number(options.cutoff));
      gl.uniform1f(u.u_sourceMix, Number(options.sourceMix));
      gl.uniform3f(u.u_positive, options.positive[0]!, options.positive[1]!, options.positive[2]!);
      gl.uniform3f(u.u_negative, options.negative[0]!, options.negative[1]!, options.negative[2]!);
      gl.uniform3f(u.u_background, options.background[0]!, options.background[1]!, options.background[2]!);
    },
  });
  if (!rendered) return input;
  logFilterBackend("Schlieren Optics", "WebGL2", `${options.mode} angle=${options.knifeAngle}`);
  return rendered;
};

export default defineFilter({
  name: "Schlieren Optics",
  func: schlierenOptics,
  optionTypes,
  options: defaults,
  defaults,
  description: "Directional knife-edge and color schlieren views of source-derived refractive gradients",
  requiresGL: true,
});
