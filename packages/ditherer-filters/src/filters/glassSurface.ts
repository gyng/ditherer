import { PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_thickness;
uniform float u_ior;
uniform float u_roughness;
uniform float u_dispersion;
uniform float u_dropletScale;
uniform float u_sourceInfluence;
uniform float u_time;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dropletField(vec2 uv) {
  vec2 grid = uv * u_dropletScale;
  vec2 id = floor(grid);
  vec2 f = fract(grid) - 0.5;
  vec2 center = vec2(hash(id), hash(id + 17.3)) * 0.55 - 0.275;
  center.y += sin(u_time * 0.7 + hash(id) * 6.283) * 0.08;
  float radius = mix(0.13, 0.38, hash(id + 9.1));
  return smoothstep(radius, radius * 0.25, length(f - center));
}
float surface(vec2 uv) {
  vec3 c = texture(u_source, clamp(uv, 0.0, 1.0)).rgb;
  float imageHeight = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(dropletField(uv), imageHeight, u_sourceInfluence);
}

void main() {
  vec2 px = 1.0 / max(u_res, vec2(1.0));
  float l = surface(v_uv - vec2(px.x, 0.0));
  float r = surface(v_uv + vec2(px.x, 0.0));
  float d = surface(v_uv - vec2(0.0, px.y));
  float u = surface(v_uv + vec2(0.0, px.y));
  vec3 normal = normalize(vec3((l - r) * u_thickness, (d - u) * u_thickness, 1.0));
  vec3 eye = vec3(0.0, 0.0, 1.0);
  vec3 ray = refract(-eye, normal, 1.0 / max(1.001, u_ior));

  vec2 marchUv = v_uv;
  float remaining = u_thickness / max(u_res.x, u_res.y);
  for (int i = 0; i < 32; i++) {
    float stepSize = remaining / 32.0;
    marchUv += ray.xy * stepSize;
    remaining -= stepSize;
    if (remaining <= 0.0001) break;
  }
  float jitter = (hash(floor(v_uv * u_res) + floor(u_time * 13.0)) - 0.5) * u_roughness;
  vec2 rough = vec2(jitter, -jitter) * px * 3.0;
  vec2 chroma = normal.xy * u_dispersion * px * u_thickness;
  float cr = texture(u_source, clamp(marchUv + rough + chroma, 0.0, 1.0)).r;
  float cg = texture(u_source, clamp(marchUv + rough, 0.0, 1.0)).g;
  float cb = texture(u_source, clamp(marchUv + rough - chroma, 0.0, 1.0)).b;
  float fresnel = pow(1.0 - max(dot(normal, eye), 0.0), 3.0);
  float highlight = pow(max(dot(reflect(normalize(vec3(-0.4, 0.5, -1.0)), normal), eye), 0.0), 32.0);
  vec3 rgb = vec3(cr, cg, cb) + fresnel * vec3(0.18, 0.24, 0.32) + highlight * (1.0 - u_roughness);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), texture(u_source, v_uv).a);
}`;

export const optionTypes = {
  thickness: { type: RANGE, range: [1, 80], step: 1, default: 28, desc: "Glass thickness and refraction travel distance" },
  ior: { type: RANGE, range: [1.01, 2.5], step: 0.01, default: 1.45, desc: "Index of refraction" },
  roughness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.12, desc: "Micro-surface blur and highlight breakup" },
  dispersion: { type: RANGE, range: [0, 3], step: 0.05, default: 0.55, desc: "Prismatic separation of red, green, and blue rays" },
  dropletScale: { type: RANGE, range: [2, 40], step: 1, default: 12, desc: "Scale of the procedural droplet surface" },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "How much source luminance shapes the glass" },
  animateSpeed: { type: RANGE, range: [0, 3], step: 0.05, default: 0.35, desc: "Droplet motion speed" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  thickness: optionTypes.thickness.default,
  ior: optionTypes.ior.default,
  roughness: optionTypes.roughness.default,
  dispersion: optionTypes.dispersion.default,
  dropletScale: optionTypes.dropletScale.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  animateSpeed: optionTypes.animateSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const glassSurface = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "glassSurface", fragmentShader: FS,
    uniformNames: ["u_thickness", "u_ior", "u_roughness", "u_dispersion", "u_dropletScale", "u_sourceInfluence", "u_time"],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_thickness, options.thickness);
      gl.uniform1f(u.u_ior, options.ior);
      gl.uniform1f(u.u_roughness, options.roughness);
      gl.uniform1f(u.u_dispersion, options.dispersion);
      gl.uniform1f(u.u_dropletScale, options.dropletScale);
      gl.uniform1f(u.u_sourceInfluence, options.sourceInfluence);
      gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * options.animateSpeed * 0.05);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend("Glass Surface", "WebGL2", `ior=${options.ior}${identity ? "" : "+palettePass"}`);
  return identity ? rendered : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Glass Surface",
  func: glassSurface,
  optionTypes,
  options: defaults,
  defaults,
  description: "Trace refracted rays through image-shaped animated glass and droplets",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
