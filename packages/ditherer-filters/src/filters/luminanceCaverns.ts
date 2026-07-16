import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
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
uniform float u_radius;
uniform float u_relief;
uniform float u_twist;
uniform float u_glow;
uniform float u_steps;
uniform float u_time;
uniform vec3 u_lightColor;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 wallUv(vec3 p) {
  float angle = atan(p.y, p.x) / 6.283185 + 0.5 + p.z * u_twist * 0.03;
  return fract(vec2(angle, p.z * 0.08 + u_time * 0.03));
}
float tunnelRadius(vec3 p) {
  float imageHeight = lum(texture(u_source, wallUv(p)).rgb);
  float strata = sin(p.z * 2.7 + atan(p.y, p.x) * 3.0) * 0.04;
  return u_radius + (imageHeight - 0.5) * u_relief + strata;
}

void main() {
  vec2 screen = v_uv * 2.0 - 1.0;
  screen.x *= u_res.x / max(u_res.y, 1.0);
  vec3 ro = vec3(sin(u_time * 0.17) * 0.08, cos(u_time * 0.13) * 0.08, u_time);
  vec3 rd = normalize(vec3(screen * 0.72, 1.0));
  float travel = 0.0;
  vec3 p = ro;
  bool hit = false;
  float maxSteps = clamp(u_steps, 24.0, 96.0);
  for (int i = 0; i < 96; i++) {
    if (float(i) >= maxSteps) break;
    p = ro + rd * travel;
    float d = tunnelRadius(p) - length(p.xy);
    if (d < 0.002) { hit = true; break; }
    travel += max(0.008, d * 0.55);
    if (travel > 14.0) break;
  }
  if (!hit) {
    fragColor = vec4(vec3(0.005, 0.008, 0.015), 1.0);
    return;
  }
  float e = 0.003;
  vec3 n = normalize(vec3(
    (tunnelRadius(p + vec3(e,0,0)) - length((p + vec3(e,0,0)).xy)) - (tunnelRadius(p - vec3(e,0,0)) - length((p - vec3(e,0,0)).xy)),
    (tunnelRadius(p + vec3(0,e,0)) - length((p + vec3(0,e,0)).xy)) - (tunnelRadius(p - vec3(0,e,0)) - length((p - vec3(0,e,0)).xy)),
    (tunnelRadius(p + vec3(0,0,e)) - length((p + vec3(0,0,e)).xy)) - (tunnelRadius(p - vec3(0,0,e)) - length((p - vec3(0,0,e)).xy))
  ));
  vec3 material = texture(u_source, wallUv(p)).rgb;
  vec3 lamp = ro + vec3(0.0, 0.0, 0.35);
  vec3 lightDir = normalize(lamp - p);
  float diffuse = 0.12 + 0.95 * max(dot(n, lightDir), 0.0);
  float mineral = pow(max(lum(material) - 0.55, 0.0) * 2.2, 2.0) * u_glow;
  float fog = exp(-travel * 0.08);
  vec3 rgb = material * diffuse * fog + (u_lightColor / 255.0) * (mineral + 0.08 / (0.2 + travel));
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  radius: { type: RANGE, range: [0.35, 1.4], step: 0.05, default: 0.78, desc: "Base radius of the fly-through tunnel" },
  relief: { type: RANGE, range: [0, 1], step: 0.05, default: 0.42, desc: "How strongly source luminance carves the cavern wall" },
  twist: { type: RANGE, range: [-4, 4], step: 0.1, default: 0.8, desc: "Spiral twist applied along the tunnel" },
  glow: { type: RANGE, range: [0, 4], step: 0.1, default: 1.3, desc: "Emission from bright mineral regions" },
  steps: { type: RANGE, range: [24, 96], step: 8, default: 72, desc: "Maximum wall-intersection steps" },
  speed: { type: RANGE, range: [0, 3], step: 0.05, default: 0.65, desc: "Forward flight speed" },
  lightColor: { type: COLOR, default: [120, 196, 255], desc: "Explorer lamp and mineral glow color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};
export const defaults = {
  radius: optionTypes.radius.default, relief: optionTypes.relief.default, twist: optionTypes.twist.default,
  glow: optionTypes.glow.default, steps: optionTypes.steps.default, speed: optionTypes.speed.default,
  lightColor: optionTypes.lightColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const luminanceCaverns = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({ source: input, width: W, height: H, key: "luminanceCaverns", fragmentShader: FS,
    uniformNames: ["u_radius", "u_relief", "u_twist", "u_glow", "u_steps", "u_time", "u_lightColor"],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_radius, options.radius); gl.uniform1f(u.u_relief, options.relief);
      gl.uniform1f(u.u_twist, options.twist); gl.uniform1f(u.u_glow, options.glow);
      gl.uniform1f(u.u_steps, options.steps); gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * options.speed * 0.035);
      gl.uniform3f(u.u_lightColor, options.lightColor[0], options.lightColor[1], options.lightColor[2]);
    } });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend("Luminance Caverns", "WebGL2", `${options.steps} steps${identity ? "" : "+palettePass"}`);
  return identity ? rendered : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};
export default defineFilter({ name: "Luminance Caverns", func: luminanceCaverns, optionTypes, options: defaults, defaults,
  description: "Fly through glowing cavern walls carved and colored by the source image", temporal: true, autoAnimate: true, autoAnimateFps: 30, requiresGL: true });
