import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_source; uniform vec2 u_res; uniform vec2 u_center;
uniform float u_mass; uniform float u_horizon; uniform float u_discRadius;
uniform float u_discWidth; uniform float u_spin; uniform float u_exposure; uniform float u_time;
uniform vec3 u_discTint;
void main() {
  vec2 aspect = vec2(u_res.x / max(u_res.y, 1.0), 1.0);
  vec2 p = (v_uv - u_center) * aspect;
  vec2 position = p;
  vec2 velocity = normalize(p + vec2(0.00001)) * 0.025;
  float closest = length(position);
  float crossedDisc = 0.0;
  vec2 discUv = v_uv;
  for (int i = 0; i < 72; i++) {
    float r = max(length(position), 0.004);
    vec2 gravity = -position / r * (u_mass / (r * r + 0.012)) * 0.00038;
    velocity += gravity;
    position += velocity;
    closest = min(closest, r);
    float ring = abs(r - u_discRadius);
    if (ring < u_discWidth) {
      crossedDisc = max(crossedDisc, 1.0 - ring / max(u_discWidth, 0.001));
      float a = atan(position.y, position.x) / 6.283185 + u_time * u_spin;
      discUv = fract(vec2(a, r * 3.0));
    }
  }
  vec2 lensedUv = u_center + position / aspect;
  vec3 background = texture(u_source, fract(lensedUv)).rgb;
  float eventMask = 1.0 - smoothstep(u_horizon * 0.82, u_horizon * 1.15, closest);
  float photonRing = exp(-abs(closest - u_horizon * 1.55) * 90.0) * u_mass;
  vec3 disc = texture(u_source, discUv).rgb * (u_discTint / 255.0) * crossedDisc * 2.4;
  float doppler = 0.65 + 0.7 * clamp(position.x / max(length(position), 0.001), -1.0, 1.0) * u_spin;
  vec3 rgb = background + disc * doppler + (u_discTint / 255.0) * photonRing;
  rgb *= 1.0 - eventMask;
  rgb = vec3(1.0) - exp(-rgb * u_exposure);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;
export const optionTypes = {
  centerX: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Horizontal gravity-well position",
  },
  centerY: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Vertical gravity-well position",
  },
  mass: {
    type: RANGE,
    range: [0.1, 3],
    step: 0.05,
    default: 1.1,
    desc: "Strength of gravitational ray bending",
  },
  horizon: {
    type: RANGE,
    range: [0.02, 0.3],
    step: 0.01,
    default: 0.105,
    desc: "Event-horizon radius",
  },
  discRadius: {
    type: RANGE,
    range: [0.08, 0.7],
    step: 0.01,
    default: 0.28,
    desc: "Accretion-disc radius",
  },
  discWidth: {
    type: RANGE,
    range: [0.01, 0.2],
    step: 0.005,
    default: 0.055,
    desc: "Accretion-disc thickness",
  },
  spin: {
    type: RANGE,
    range: [-3, 3],
    step: 0.05,
    default: 0.8,
    desc: "Disc rotation and Doppler asymmetry",
  },
  exposure: {
    type: RANGE,
    range: [0.25, 3],
    step: 0.05,
    default: 1.2,
    desc: "Tone-mapped lens and disc exposure",
  },
  discTint: { type: COLOR, default: [255, 142, 72], desc: "Accretion and photon-ring color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};
export const defaults = {
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  mass: optionTypes.mass.default,
  horizon: optionTypes.horizon.default,
  discRadius: optionTypes.discRadius.default,
  discWidth: optionTypes.discWidth.default,
  spin: optionTypes.spin.default,
  exposure: optionTypes.exposure.default,
  discTint: optionTypes.discTint.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};
const blackHoleLens = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "blackHoleLens",
    fragmentShader: FS,
    uniformNames: [
      "u_center",
      "u_mass",
      "u_horizon",
      "u_discRadius",
      "u_discWidth",
      "u_spin",
      "u_exposure",
      "u_time",
      "u_discTint",
    ],
    setUniforms: (gl, u) => {
      gl.uniform2f(u.u_center, options.centerX, 1 - options.centerY);
      gl.uniform1f(u.u_mass, options.mass);
      gl.uniform1f(u.u_horizon, options.horizon);
      gl.uniform1f(u.u_discRadius, options.discRadius);
      gl.uniform1f(u.u_discWidth, options.discWidth);
      gl.uniform1f(u.u_spin, options.spin);
      gl.uniform1f(u.u_exposure, options.exposure);
      gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * 0.012);
      gl.uniform3f(u.u_discTint, options.discTint[0], options.discTint[1], options.discTint[2]);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Black Hole Lens",
    "WebGL2",
    `mass=${options.mass}${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};
export default defineFilter({
  name: "Black Hole Lens",
  func: blackHoleLens,
  optionTypes,
  options: defaults,
  defaults,
  description: "Bend source-image rays around an event horizon and glowing accretion disc",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
