import { PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_source; uniform vec2 u_res; uniform float u_thickness;
uniform float u_variation; uniform float u_ior; uniform float u_lightAngle;
uniform float u_intensity; uniform float u_roughness; uniform float u_time;
float h(vec2 uv) { return dot(texture(u_source, clamp(uv,0.0,1.0)).rgb, vec3(0.2126,0.7152,0.0722)); }
void main() {
  vec2 px = 1.0 / max(u_res, vec2(1.0));
  vec3 n = normalize(vec3((h(v_uv-vec2(px.x,0))-h(v_uv+vec2(px.x,0))) * u_variation,
                          (h(v_uv-vec2(0,px.y))-h(v_uv+vec2(0,px.y))) * u_variation, 1.0));
  float a = radians(u_lightAngle); vec3 light = normalize(vec3(cos(a), sin(a), 0.8));
  float cosTheta = clamp(dot(n, light), 0.0, 1.0);
  float optical = (u_thickness + h(v_uv) * u_variation * 180.0 + sin(u_time + v_uv.x*9.0)*18.0) * u_ior * max(cosTheta, 0.12);
  vec3 wavelengths = vec3(650.0, 510.0, 440.0);
  vec3 phase = 6.283185 * optical / wavelengths;
  vec3 interference = 0.5 + 0.5 * cos(phase);
  interference = mix(interference, vec3(dot(interference, vec3(0.333))), u_roughness);
  float fresnel = pow(1.0 - max(n.z, 0.0), 3.0);
  vec4 src = texture(u_source, v_uv);
  vec3 rgb = mix(src.rgb, src.rgb * (0.35 + interference * 1.25), u_intensity) + interference * fresnel * 0.35;
  fragColor = vec4(clamp(rgb,0.0,1.0), src.a);
}`;
export const optionTypes = {
  thickness: {
    type: RANGE,
    range: [80, 1200],
    step: 10,
    default: 420,
    desc: "Base optical film thickness in nanometers",
  },
  variation: {
    type: RANGE,
    range: [0, 8],
    step: 0.1,
    default: 3.2,
    desc: "Luminance-driven thickness and normal variation",
  },
  ior: {
    type: RANGE,
    range: [1.01, 2.5],
    step: 0.01,
    default: 1.42,
    desc: "Film index of refraction",
  },
  lightAngle: {
    type: RANGE,
    range: [0, 360],
    step: 1,
    default: 135,
    desc: "Incident light direction",
  },
  intensity: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.8,
    desc: "Interference color strength",
  },
  roughness: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.12,
    desc: "Microscopic disorder that softens spectral bands",
  },
  driftSpeed: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 0.12,
    desc: "Slow film-thickness drift speed",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};
export const defaults = {
  thickness: optionTypes.thickness.default,
  variation: optionTypes.variation.default,
  ior: optionTypes.ior.default,
  lightAngle: optionTypes.lightAngle.default,
  intensity: optionTypes.intensity.default,
  roughness: optionTypes.roughness.default,
  driftSpeed: optionTypes.driftSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};
const thinFilmIridescence = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "thinFilmIridescence",
    fragmentShader: FS,
    uniformNames: [
      "u_thickness",
      "u_variation",
      "u_ior",
      "u_lightAngle",
      "u_intensity",
      "u_roughness",
      "u_time",
    ],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_thickness, options.thickness);
      gl.uniform1f(u.u_variation, options.variation);
      gl.uniform1f(u.u_ior, options.ior);
      gl.uniform1f(u.u_lightAngle, options.lightAngle);
      gl.uniform1f(u.u_intensity, options.intensity);
      gl.uniform1f(u.u_roughness, options.roughness);
      gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * options.driftSpeed * 0.02);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Thin-Film Iridescence",
    "WebGL2",
    `thickness=${options.thickness}nm${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};
export default defineFilter({
  name: "Thin-Film Iridescence",
  func: thinFilmIridescence,
  optionTypes,
  options: defaults,
  defaults,
  description: "Simulate wavelength-dependent soap, oil, shell, and holographic-film interference",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 24,
  requiresGL: true,
});
