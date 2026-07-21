import { ACTION, ENUM, RANGE } from "../constants/controlTypes";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { dlpSubfieldOffsets } from "./unusualDisplayContracts";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

const WHEEL_RGB = "RGB";
const WHEEL_RGBW = "RGBW";

export const optionTypes = {
  wheel: { type: ENUM, options: [
    { name: "RGB wheel", value: WHEEL_RGB },
    { name: "RGBW wheel", value: WHEEL_RGBW },
  ], default: WHEEL_RGB, desc: "Sequential illumination segments; a white segment raises brightness but dilutes saturation" },
  colorCycles: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "RGB sequences per video frame; more cycles reduce visible color breakup" },
  motionX: { type: RANGE, range: [-40, 40], step: 0.5, default: 10, desc: "Horizontal eye, camera, or scene motion during one color sequence, in pixels" },
  motionY: { type: RANGE, range: [-40, 40], step: 0.5, default: -3, desc: "Vertical eye, camera, or scene motion during one color sequence, in pixels" },
  breakup: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Visibility of sequential red/green/blue subfield separation" },
  bitplaneSparkle: { type: RANGE, range: [0, 0.35], step: 0.01, default: 0.035, desc: "Micromirror bit-plane contouring and deterministic temporal sparkle" },
  lensSoftness: { type: RANGE, range: [0, 2.5], step: 0.1, default: 0.45, desc: "Projection-lens blur applied across each color subfield" },
  animSpeed: { type: RANGE, range: [24, 120], step: 1, default: 60, desc: "Preview frame rate used to advance color-wheel and bit-plane phase" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Advance the sequential illumination and micromirror phase",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, Number(options.animSpeed) || 60);
    },
  },
};

export const defaults = {
  wheel: optionTypes.wheel.default,
  colorCycles: optionTypes.colorCycles.default,
  motionX: optionTypes.motionX.default,
  motionY: optionTypes.motionY.default,
  breakup: optionTypes.breakup.default,
  bitplaneSparkle: optionTypes.bitplaneSparkle.default,
  lensSoftness: optionTypes.lensSoftness.default,
  animSpeed: optionTypes.animSpeed.default,
};

type DlpOptions = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform vec2 u_redOffset;
uniform vec2 u_blueOffset;
uniform float u_breakup;
uniform float u_sparkle;
uniform float u_softness;
uniform float u_phase;
uniform int u_rgbw;

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33 + u_phase * 0.017);
  return fract((p.x + p.y) * p.x);
}

vec3 sampleSoft(vec2 uv) {
  vec2 px = vec2(1.0) / u_res;
  vec3 center = texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  vec3 sides = texture(u_source, clamp(uv + vec2(px.x, 0.0), vec2(0.0), vec2(1.0))).rgb
    + texture(u_source, clamp(uv - vec2(px.x, 0.0), vec2(0.0), vec2(1.0))).rgb
    + texture(u_source, clamp(uv + vec2(0.0, px.y), vec2(0.0), vec2(1.0))).rgb
    + texture(u_source, clamp(uv - vec2(0.0, px.y), vec2(0.0), vec2(1.0))).rgb;
  return mix(center, sides * 0.25, clamp(u_softness / 2.5, 0.0, 1.0));
}

void main() {
  vec2 redUv = v_uv + vec2(u_redOffset.x, -u_redOffset.y) / u_res * u_breakup;
  vec2 blueUv = v_uv + vec2(u_blueOffset.x, -u_blueOffset.y) / u_res * u_breakup;
  vec3 middle = sampleSoft(v_uv);
  vec3 separated = vec3(sampleSoft(redUv).r, middle.g, sampleSoft(blueUv).b);
  if (u_rgbw == 1) {
    float whiteSegment = min(min(middle.r, middle.g), middle.b);
    separated = mix(separated, vec3(whiteSegment) + separated * 0.78, 0.22);
  }
  vec2 pixel = floor(vec2(v_uv.x * u_res.x, v_uv.y * u_res.y));
  float bitBand = floor(max(max(separated.r, separated.g), separated.b) * 16.0) / 16.0;
  float sparkle = (hash(pixel + floor(u_phase)) - 0.5) * u_sparkle * (0.35 + bitBand);
  separated += sparkle;
  fragColor = vec4(clamp(separated, 0.0, 1.0), 1.0);
}
`;

const clamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const parsed = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(parsed) ? parsed : fallback));
};

const dlpColorWheel = (input: FilterCanvas, options: DlpOptions = defaults): FilterCanvas => {
  const cycles = Math.round(clamp(options.colorCycles, defaults.colorCycles, 1, 6));
  const offsets = dlpSubfieldOffsets(
    clamp(options.motionX, defaults.motionX, -40, 40),
    clamp(options.motionY, defaults.motionY, -40, 40),
    cycles,
  );
  const frame = clamp(options._frameIndex, 0, 0, 1_000_000);
  const output = renderGLSinglePass({
    source: input,
    width: input.width,
    height: input.height,
    key: "dlp-color-wheel:v1",
    fragmentShader: FS,
    uniformNames: ["u_redOffset", "u_blueOffset", "u_breakup", "u_sparkle", "u_softness", "u_phase", "u_rgbw"],
    setUniforms: (gl, uniforms) => {
      gl.uniform2f(uniforms.u_redOffset, offsets.red.x, offsets.red.y);
      gl.uniform2f(uniforms.u_blueOffset, offsets.blue.x, offsets.blue.y);
      gl.uniform1f(uniforms.u_breakup, clamp(options.breakup, defaults.breakup, 0, 2));
      gl.uniform1f(uniforms.u_sparkle, clamp(options.bitplaneSparkle, defaults.bitplaneSparkle, 0, 0.35));
      gl.uniform1f(uniforms.u_softness, clamp(options.lensSoftness, defaults.lensSoftness, 0, 2.5));
      gl.uniform1f(uniforms.u_phase, frame);
      gl.uniform1i(uniforms.u_rgbw, options.wheel === WHEEL_RGBW ? 1 : 0);
    },
  });
  if (!output) return input;
  logFilterBackend("DLP Color Wheel", "WebGL2", `${cycles}x ${options.wheel === WHEEL_RGBW ? "RGBW" : "RGB"} sequential illumination`);
  return output;
};

export default defineFilter({
  name: "DLP Color Wheel",
  func: dlpColorWheel,
  optionTypes,
  defaults,
  options: defaults,
  description: "Single-chip DLP projection with sequential color fields, motion breakup, micromirror bit planes, and lens softness",
  requiresGL: true,
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 60,
});
