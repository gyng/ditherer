import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { SRGB_GLSL } from "./opticalConvolutionContracts";

// Ray-marched light shafts are a linear-light phenomenon: emitter brightness is
// radiant energy, the accumulation integrates that energy along the ray, and the
// shafts add to the scene as emitted light. We therefore linearize the sampled
// source before measuring emitter luma, accumulate scattered light in linear,
// linearize the sRGB shaft tint, do the additive composite in linear, and only
// then re-encode to sRGB (the previous filter did all of this in gamma, which
// under-weighted bright emitters and over-brightened midtones).
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform vec2 u_lightPos;
uniform float u_density;
uniform float u_decay;
uniform float u_exposure;
uniform float u_threshold;
uniform float u_noise;
uniform float u_time;
uniform vec3 u_tint;
${SRGB_GLSL}

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453); }
float emitter(vec2 uv) {
  vec3 c = oc_srgbToLinear(texture(u_source, clamp(uv, 0.0, 1.0)).rgb);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float lo = oc_srgbToLinear(vec3(u_threshold)).r;
  float hi = oc_srgbToLinear(vec3(min(1.0, u_threshold + 0.2))).r;
  return smoothstep(lo, max(lo + 1e-4, hi), lum);
}

void main() {
  vec2 delta = (u_lightPos - v_uv) * u_density / 64.0;
  vec2 uv = v_uv;
  float illumination = 1.0;
  float scattered = 0.0;
  for (int i = 0; i < 64; i++) {
    uv += delta;
    float grain = mix(1.0, 0.55 + 0.9 * hash(floor(uv * u_res * 0.2) + u_time), u_noise);
    scattered += emitter(uv) * illumination * grain;
    illumination *= u_decay;
  }
  vec4 source = texture(u_source, v_uv);
  vec3 srcLin = oc_srgbToLinear(source.rgb);
  vec3 tintLin = oc_srgbToLinear(u_tint / 255.0);
  float radial = 1.0 / (1.0 + distance(v_uv, u_lightPos) * 2.0);
  vec3 shafts = tintLin * scattered * u_exposure * radial;
  fragColor = vec4(oc_linearToSrgb(srcLin + shafts), source.a);
}`;

export const optionTypes = {
  lightX: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Horizontal light position across the image",
  },
  lightY: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.2,
    desc: "Vertical light position across the image",
  },
  density: {
    type: RANGE,
    range: [0.1, 2],
    step: 0.05,
    default: 0.9,
    desc: "Length and spacing of the integrated light ray",
  },
  decay: {
    type: RANGE,
    range: [0.85, 1],
    step: 0.0025,
    default: 0.965,
    desc: "Light retained at each ray-march step",
  },
  exposure: {
    type: RANGE,
    range: [0, 0.2],
    step: 0.005,
    default: 0.055,
    desc: "Overall volumetric shaft brightness",
  },
  threshold: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.62,
    desc: "Source luminance that emits into the fog",
  },
  noise: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.28,
    desc: "Animated density variation in the fog",
  },
  animateSpeed: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 0.5,
    desc: "Fog-noise animation speed",
  },
  tint: { type: COLOR, default: [255, 224, 168], desc: "Scattered light color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  lightX: optionTypes.lightX.default,
  lightY: optionTypes.lightY.default,
  density: optionTypes.density.default,
  decay: optionTypes.decay.default,
  exposure: optionTypes.exposure.default,
  threshold: optionTypes.threshold.default,
  noise: optionTypes.noise.default,
  animateSpeed: optionTypes.animateSpeed.default,
  tint: optionTypes.tint.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const volumetricLight = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "volumetricLight",
    fragmentShader: FS,
    uniformNames: [
      "u_lightPos",
      "u_density",
      "u_decay",
      "u_exposure",
      "u_threshold",
      "u_noise",
      "u_time",
      "u_tint",
    ],
    setUniforms: (gl, u) => {
      gl.uniform2f(u.u_lightPos, options.lightX, 1 - options.lightY);
      gl.uniform1f(u.u_density, options.density);
      gl.uniform1f(u.u_decay, options.decay);
      gl.uniform1f(u.u_exposure, options.exposure);
      gl.uniform1f(u.u_threshold, options.threshold);
      gl.uniform1f(u.u_noise, options.noise);
      gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * options.animateSpeed * 0.07);
      gl.uniform3f(u.u_tint, options.tint[0], options.tint[1], options.tint[2]);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Volumetric Light",
    "WebGL2",
    `density=${options.density} linear-shafts${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Volumetric Light",
  func: volumetricLight,
  optionTypes,
  options: defaults,
  defaults,
  description: "Integrate bright source pixels through animated fog into volumetric light shafts",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
