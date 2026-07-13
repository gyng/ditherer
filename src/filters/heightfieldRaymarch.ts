import { PALETTE, RANGE } from "constants/controlTypes";
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
uniform float u_viewAngle;
uniform float u_viewTilt;
uniform float u_lightAngle;
uniform float u_specular;
uniform float u_shadow;
uniform float u_steps;

float heightAt(vec2 uv) {
  vec3 c = texture(u_source, clamp(uv, 0.0, 1.0)).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  float a = radians(u_viewAngle);
  vec2 viewDir = vec2(cos(a), sin(a));
  float layers = clamp(u_steps, 8.0, 64.0);
  vec2 shift = viewDir * u_depth * (0.15 + u_viewTilt * 0.35) / max(u_res, vec2(1.0));
  vec2 uv = v_uv + shift * 0.5;
  vec2 delta = shift / layers;
  float layer = 1.0;
  float layerStep = 1.0 / layers;
  vec2 hitUv = uv;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= layers) break;
    float h = heightAt(uv);
    hitUv = uv;
    if (layer <= h) break;
    uv -= delta;
    layer -= layerStep;
  }

  vec2 px = 1.0 / max(u_res, vec2(1.0));
  float hL = heightAt(hitUv - vec2(px.x, 0.0));
  float hR = heightAt(hitUv + vec2(px.x, 0.0));
  float hD = heightAt(hitUv - vec2(0.0, px.y));
  float hU = heightAt(hitUv + vec2(0.0, px.y));
  vec3 n = normalize(vec3((hL - hR) * u_depth, (hD - hU) * u_depth, 1.0));
  float la = radians(u_lightAngle);
  vec3 light = normalize(vec3(cos(la), sin(la), 0.75));
  float diffuse = max(dot(n, light), 0.0);
  float spec = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * u_specular;

  float occlusion = 0.0;
  vec2 lightStep = light.xy * px * max(1.0, u_depth * 0.35);
  float rayHeight = heightAt(hitUv);
  vec2 shadowUv = hitUv;
  for (int i = 1; i <= 16; i++) {
    shadowUv += lightStep;
    rayHeight += light.z * 0.025;
    if (heightAt(shadowUv) > rayHeight) { occlusion = 1.0; break; }
  }

  vec4 src = texture(u_source, clamp(hitUv, 0.0, 1.0));
  float shade = (0.28 + diffuse * 0.92) * mix(1.0, 0.45, occlusion * u_shadow);
  vec3 rgb = clamp(src.rgb * shade + spec, 0.0, 1.0);
  fragColor = vec4(rgb, src.a);
}`;

export const optionTypes = {
  depth: { type: RANGE, range: [1, 80], step: 1, default: 28, desc: "Luminance height and parallax depth in pixels" },
  viewAngle: { type: RANGE, range: [0, 360], step: 1, default: 225, desc: "Direction from which the height field is viewed" },
  viewTilt: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "Grazing angle of the virtual camera" },
  lightAngle: { type: RANGE, range: [0, 360], step: 1, default: 135, desc: "Direction of the surface light" },
  specular: { type: RANGE, range: [0, 2], step: 0.05, default: 0.4, desc: "Glossy highlight strength" },
  shadow: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "Self-shadow strength" },
  steps: { type: RANGE, range: [8, 64], step: 4, default: 40, desc: "Ray-march steps; more resolves finer relief" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  depth: optionTypes.depth.default,
  viewAngle: optionTypes.viewAngle.default,
  viewTilt: optionTypes.viewTilt.default,
  lightAngle: optionTypes.lightAngle.default,
  specular: optionTypes.specular.default,
  shadow: optionTypes.shadow.default,
  steps: optionTypes.steps.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const heightfieldRaymarch = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "heightfieldRaymarch", fragmentShader: FS,
    uniformNames: ["u_depth", "u_viewAngle", "u_viewTilt", "u_lightAngle", "u_specular", "u_shadow", "u_steps"],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_depth, options.depth);
      gl.uniform1f(u.u_viewAngle, options.viewAngle);
      gl.uniform1f(u.u_viewTilt, options.viewTilt);
      gl.uniform1f(u.u_lightAngle, options.lightAngle);
      gl.uniform1f(u.u_specular, options.specular);
      gl.uniform1f(u.u_shadow, options.shadow);
      gl.uniform1f(u.u_steps, options.steps);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend("Heightfield Raymarch", "WebGL2", `${options.steps} steps${identity ? "" : "+palettePass"}`);
  return identity ? rendered : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Heightfield Raymarch",
  func: heightfieldRaymarch,
  optionTypes,
  options: defaults,
  defaults,
  description: "Ray-march image luminance as a deep, self-shadowing 2.5D relief",
  requiresGL: true,
});
