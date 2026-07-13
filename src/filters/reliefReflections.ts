import { COLOR, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderGLSinglePass } from "utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_depth;
uniform float u_reflectivity;
uniform float u_roughness;
uniform float u_distance;
uniform float u_steps;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;

float h(vec2 uv) { return dot(texture(u_source, clamp(uv, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 px = 1.0 / max(u_res, vec2(1.0));
  float hL = h(v_uv - vec2(px.x, 0.0));
  float hR = h(v_uv + vec2(px.x, 0.0));
  float hD = h(v_uv - vec2(0.0, px.y));
  float hU = h(v_uv + vec2(0.0, px.y));
  vec3 n = normalize(vec3((hL - hR) * u_depth, (hD - hU) * u_depth, 1.0));
  vec3 view = normalize(vec3((v_uv - 0.5) * 0.35, 1.0));
  vec3 reflected = reflect(-view, n);
  vec2 rayUv = v_uv;
  float rayHeight = h(v_uv) + 0.015;
  float layers = clamp(u_steps, 8.0, 64.0);
  vec2 delta = reflected.xy * u_distance / max(u_res, vec2(1.0)) / layers;
  float dz = reflected.z * u_distance / max(u_res.x, u_res.y) / layers;
  vec2 hitUv = vec2(-1.0);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= layers) break;
    rayUv += delta;
    rayHeight += dz;
    if (rayUv.x < 0.0 || rayUv.x > 1.0 || rayUv.y < 0.0 || rayUv.y > 1.0) break;
    if (h(rayUv) > rayHeight) { hitUv = rayUv; break; }
  }

  vec4 source = texture(u_source, v_uv);
  vec3 sky = mix(u_skyBottom, u_skyTop, clamp(reflected.y * 0.5 + 0.5, 0.0, 1.0)) / 255.0;
  vec3 reflectedColor = hitUv.x >= 0.0 ? texture(u_source, hitUv).rgb : sky;
  reflectedColor = mix(reflectedColor, vec3(dot(reflectedColor, vec3(0.333))), u_roughness * 0.35);
  float fresnel = mix(0.18, 1.0, pow(1.0 - max(dot(n, view), 0.0), 3.0));
  vec3 rgb = mix(source.rgb, reflectedColor, u_reflectivity * fresnel);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), source.a);
}`;

export const optionTypes = {
  depth: { type: RANGE, range: [1, 80], step: 1, default: 26, desc: "Height scale used to derive the reflecting normal" },
  reflectivity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "Strength of traced reflections" },
  roughness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Desaturate and soften reflected detail" },
  distance: { type: RANGE, range: [4, 180], step: 2, default: 72, desc: "Maximum screen-space reflection ray distance" },
  steps: { type: RANGE, range: [8, 64], step: 4, default: 48, desc: "Heightfield intersection samples" },
  skyTop: { type: COLOR, default: [82, 134, 210], desc: "Environment color for upward reflection misses" },
  skyBottom: { type: COLOR, default: [238, 184, 132], desc: "Environment color for horizon reflection misses" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  depth: optionTypes.depth.default,
  reflectivity: optionTypes.reflectivity.default,
  roughness: optionTypes.roughness.default,
  distance: optionTypes.distance.default,
  steps: optionTypes.steps.default,
  skyTop: optionTypes.skyTop.default,
  skyBottom: optionTypes.skyBottom.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const reliefReflections = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "reliefReflections", fragmentShader: FS,
    uniformNames: ["u_depth", "u_reflectivity", "u_roughness", "u_distance", "u_steps", "u_skyTop", "u_skyBottom"],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_depth, options.depth);
      gl.uniform1f(u.u_reflectivity, options.reflectivity);
      gl.uniform1f(u.u_roughness, options.roughness);
      gl.uniform1f(u.u_distance, options.distance);
      gl.uniform1f(u.u_steps, options.steps);
      gl.uniform3f(u.u_skyTop, options.skyTop[0], options.skyTop[1], options.skyTop[2]);
      gl.uniform3f(u.u_skyBottom, options.skyBottom[0], options.skyBottom[1], options.skyBottom[2]);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend("Relief Reflections", "WebGL2", `${options.steps} steps${identity ? "" : "+palettePass"}`);
  return identity ? rendered : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Relief Reflections",
  func: reliefReflections,
  optionTypes,
  options: defaults,
  defaults,
  description: "Trace screen-space reflections across a luminance-derived relief surface",
  requiresGL: true,
});
