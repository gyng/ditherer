import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderGLSinglePass } from "utils/glSinglePass";

const FRACTAL = { MANDELBULB: "MANDELBULB", JULIA_BULB: "JULIA_BULB" };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_power;
uniform float u_iterations;
uniform float u_detail;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_zoom;
uniform float u_materialMix;
uniform float u_time;
uniform vec3 u_background;

float de(vec3 p) {
  vec3 z = p;
  float dr = 1.0;
  float r = 0.0;
  vec3 c = u_mode == 1 ? vec3(-0.22, 0.31, -0.17) : p;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= u_iterations) break;
    r = length(z);
    if (r > 2.4) break;
    float theta = acos(clamp(z.z / max(r, 0.00001), -1.0, 1.0));
    float phi = atan(z.y, z.x);
    float zr = pow(r, u_power);
    dr = pow(r, u_power - 1.0) * u_power * dr + 1.0;
    theta *= u_power;
    phi *= u_power;
    z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + c;
  }
  return 0.5 * log(max(r, 0.00001)) * r / max(dr, 0.00001);
}
vec3 normalAt(vec3 p) {
  float e = 0.0015;
  return normalize(vec3(
    de(p + vec3(e,0,0)) - de(p - vec3(e,0,0)),
    de(p + vec3(0,e,0)) - de(p - vec3(0,e,0)),
    de(p + vec3(0,0,e)) - de(p - vec3(0,0,e))
  ));
}

void main() {
  vec2 screen = v_uv * 2.0 - 1.0;
  screen.x *= u_res.x / max(u_res.y, 1.0);
  float yaw = radians(u_yaw) + u_time;
  float pitch = radians(u_pitch);
  vec3 ro = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * u_zoom;
  vec3 forward = normalize(-ro);
  vec3 right = normalize(cross(forward, vec3(0,1,0)));
  vec3 up = cross(right, forward);
  vec3 rd = normalize(forward + right * screen.x * 0.65 + up * screen.y * 0.65);
  float t = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 96; i++) {
    p = ro + rd * t;
    float dist = de(p);
    if (dist < u_detail) { hit = true; break; }
    t += dist * 0.72;
    if (t > 7.0) break;
  }
  vec4 backdrop = texture(u_source, v_uv);
  if (!hit) {
    vec3 bg = mix(u_background / 255.0, backdrop.rgb, 0.45);
    fragColor = vec4(bg, backdrop.a);
    return;
  }
  vec3 n = normalAt(p);
  vec3 light = normalize(vec3(-0.5, 0.7, 0.8));
  float diffuse = 0.2 + 0.85 * max(dot(n, light), 0.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  vec2 sphereUv = vec2(atan(n.z, n.x) / 6.28318 + 0.5, acos(clamp(n.y, -1.0, 1.0)) / 3.14159);
  vec3 imageMaterial = texture(u_source, sphereUv).rgb;
  vec3 orbitColor = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + length(p) * 8.0 + float(u_mode));
  vec3 material = mix(orbitColor, imageMaterial, u_materialMix);
  fragColor = vec4(clamp(material * diffuse + rim * vec3(0.4, 0.65, 1.0), 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  fractal: {
    type: ENUM,
    options: [{ name: "Mandelbulb", value: FRACTAL.MANDELBULB }, { name: "Julia bulb", value: FRACTAL.JULIA_BULB }],
    default: FRACTAL.MANDELBULB,
    desc: "Distance-estimator family to sphere-trace",
  },
  power: { type: RANGE, range: [2, 12], step: 0.25, default: 8, desc: "Bulb exponent controlling lobes and symmetry" },
  iterations: { type: RANGE, range: [3, 12], step: 1, default: 8, desc: "Distance-estimator iterations" },
  detail: { type: RANGE, range: [0.0005, 0.01], step: 0.0005, default: 0.002, desc: "Surface hit tolerance; lower reveals finer detail" },
  yaw: { type: RANGE, range: [-180, 180], step: 1, default: 25, desc: "Camera orbit around the fractal" },
  pitch: { type: RANGE, range: [-80, 80], step: 1, default: 12, desc: "Camera elevation" },
  zoom: { type: RANGE, range: [1.8, 5], step: 0.05, default: 3.1, desc: "Camera distance from the fractal" },
  materialMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "Use source image color instead of procedural orbit color" },
  rotateSpeed: { type: RANGE, range: [0, 2], step: 0.05, default: 0.18, desc: "Automatic portal rotation speed" },
  background: { type: COLOR, default: [8, 6, 18], desc: "Portal background tint" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  fractal: optionTypes.fractal.default,
  power: optionTypes.power.default,
  iterations: optionTypes.iterations.default,
  detail: optionTypes.detail.default,
  yaw: optionTypes.yaw.default,
  pitch: optionTypes.pitch.default,
  zoom: optionTypes.zoom.default,
  materialMix: optionTypes.materialMix.default,
  rotateSpeed: optionTypes.rotateSpeed.default,
  background: optionTypes.background.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const fractalPortal = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "fractalPortal", fragmentShader: FS,
    uniformNames: ["u_mode", "u_power", "u_iterations", "u_detail", "u_yaw", "u_pitch", "u_zoom", "u_materialMix", "u_time", "u_background"],
    setUniforms: (gl, u) => {
      gl.uniform1i(u.u_mode, options.fractal === FRACTAL.JULIA_BULB ? 1 : 0);
      gl.uniform1f(u.u_power, options.power);
      gl.uniform1f(u.u_iterations, options.iterations);
      gl.uniform1f(u.u_detail, options.detail);
      gl.uniform1f(u.u_yaw, options.yaw);
      gl.uniform1f(u.u_pitch, options.pitch);
      gl.uniform1f(u.u_zoom, options.zoom);
      gl.uniform1f(u.u_materialMix, options.materialMix);
      gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * options.rotateSpeed * 0.012);
      gl.uniform3f(u.u_background, options.background[0], options.background[1], options.background[2]);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend("Fractal Portal", "WebGL2", `${options.fractal} iter=${options.iterations}${identity ? "" : "+palettePass"}`);
  return identity ? rendered : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Fractal Portal",
  func: fractalPortal,
  optionTypes,
  options: defaults,
  defaults,
  description: "Sphere-trace a Mandelbulb or Julia bulb textured by the source image",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
