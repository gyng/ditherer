import { ACTION, BOOL, ENUM, RANGE } from "../constants/controlTypes";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { bairdFrameIndex } from "./unusualDisplayContracts";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

const TINT_AMBER = "AMBER";
const TINT_RED = "RED";
const TINT_MONO = "MONO";

export const optionTypes = {
  originalAspect: {
    type: BOOL,
    default: true,
    desc: "Present the historical narrow 3:7 portrait picture instead of filling the canvas",
  },
  tint: {
    type: ENUM,
    options: [
      { name: "Amber neon", value: TINT_AMBER },
      { name: "Red neon", value: TINT_RED },
      { name: "Neutral lamp", value: TINT_MONO },
    ],
    default: TINT_AMBER,
    desc: "Color of the receiver's modulated neon viewing lamp",
  },
  spotSize: {
    type: RANGE,
    range: [0.25, 1.5],
    step: 0.05,
    default: 0.82,
    desc: "Diameter of the scanning aperture relative to one raster cell",
  },
  bandwidth: {
    type: RANGE,
    range: [0.15, 1],
    step: 0.05,
    default: 0.55,
    desc: "Audio-channel video bandwidth; lower values smear detail along each vertical scan",
  },
  discWobble: {
    type: RANGE,
    range: [0, 1.5],
    step: 0.05,
    default: 0.28,
    desc: "Nipkow-disc eccentricity measured in scan-column widths",
  },
  syncDrift: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 0.18,
    desc: "Vertical picture slip caused by imperfect motor synchronization",
  },
  flicker: {
    type: RANGE,
    range: [0, 0.6],
    step: 0.02,
    default: 0.16,
    desc: "Brightness fluctuation at the fixed 12.5-picture-per-second cadence",
  },
  animSpeed: {
    type: RANGE,
    range: [13, 60],
    step: 1,
    default: 25,
    desc: "Preview frame rate; the simulated picture cadence remains 12.5 Hz",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Run the mechanical disc, synchronization drift, and neon flicker",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, Number(options.animSpeed) || 25);
    },
  },
};

export const defaults = {
  originalAspect: optionTypes.originalAspect.default,
  tint: optionTypes.tint.default,
  spotSize: optionTypes.spotSize.default,
  bandwidth: optionTypes.bandwidth.default,
  discWobble: optionTypes.discWobble.default,
  syncDrift: optionTypes.syncDrift.default,
  flicker: optionTypes.flicker.default,
  animSpeed: optionTypes.animSpeed.default,
};

type BairdOptions = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_frame;
uniform float u_spotSize;
uniform float u_bandwidth;
uniform float u_wobble;
uniform float u_syncDrift;
uniform float u_flicker;
uniform int u_originalAspect;
uniform int u_tint;

float sourceLuma(vec2 uv) {
  vec3 rgb = texture(u_source, vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0))).rgb;
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 js = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 panelSize = u_res;
  if (u_originalAspect == 1) {
    panelSize.x = min(u_res.x, u_res.y * 3.0 / 7.0);
    panelSize.y = min(u_res.y, panelSize.x * 7.0 / 3.0);
  }
  vec2 origin = (u_res - panelSize) * 0.5;
  vec2 p = (js - origin) / panelSize;
  if (p.x < 0.0 || p.x >= 1.0 || p.y < 0.0 || p.y >= 1.0) {
    fragColor = vec4(vec3(0.006, 0.004, 0.002), 1.0);
    return;
  }

  float verticalSlip = sin(u_frame * 0.71) * u_syncDrift / 70.0;
  float scanY = fract(p.y + verticalSlip);
  float line = floor(p.x * 30.0);
  float row = floor(scanY * 70.0);
  float eccentricity = sin(row * 0.31 + u_frame * 0.83) * u_wobble;
  float sourceX = (line + 0.5 + eccentricity) / 30.0;
  float sourceY = (row + 0.5) / 70.0;
  float blur = mix(2.8, 0.35, u_bandwidth) / 70.0;
  float level = sourceLuma(vec2(sourceX, sourceY)) * 0.42
    + (sourceLuma(vec2(sourceX, sourceY - blur)) + sourceLuma(vec2(sourceX, sourceY + blur))) * 0.22
    + (sourceLuma(vec2(sourceX, sourceY - blur * 2.0)) + sourceLuma(vec2(sourceX, sourceY + blur * 2.0))) * 0.07;

  vec2 within = vec2(fract(p.x * 30.0), fract(scanY * 70.0)) - 0.5;
  float aperture = exp(-dot(within, within) * 7.5 / max(0.08, u_spotSize * u_spotSize));
  float edge = pow(max(0.0, 1.0 - length((p - 0.5) * vec2(1.15, 0.72))), 0.32);
  float flicker = 1.0 - u_flicker * (0.35 + 0.65 * abs(sin(u_frame * 3.14159265)));
  float glow = clamp(level * (0.34 + aperture * 1.35) * edge * flicker, 0.0, 1.0);
  vec3 tint = u_tint == 1 ? vec3(1.0, 0.16, 0.045)
    : u_tint == 2 ? vec3(1.0)
    : vec3(1.0, 0.43, 0.075);
  vec3 color = tint * glow + tint * glow * glow * 0.32;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const clamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const parsed = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(parsed) ? parsed : fallback));
};

const bairdTelevisor = (input: FilterCanvas, options: BairdOptions = defaults): FilterCanvas => {
  const speed = clamp(options.animSpeed, defaults.animSpeed, 13, 60);
  const picture = bairdFrameIndex(Number(options._frameIndex), speed);
  const tint = options.tint === TINT_RED ? 1 : options.tint === TINT_MONO ? 2 : 0;
  const output = renderGLSinglePass({
    source: input,
    width: input.width,
    height: input.height,
    key: "baird-televisor:v1",
    fragmentShader: FS,
    uniformNames: [
      "u_frame",
      "u_spotSize",
      "u_bandwidth",
      "u_wobble",
      "u_syncDrift",
      "u_flicker",
      "u_originalAspect",
      "u_tint",
    ],
    setUniforms: (gl, uniforms) => {
      gl.uniform1f(uniforms.u_frame, picture);
      gl.uniform1f(uniforms.u_spotSize, clamp(options.spotSize, defaults.spotSize, 0.25, 1.5));
      gl.uniform1f(uniforms.u_bandwidth, clamp(options.bandwidth, defaults.bandwidth, 0.15, 1));
      gl.uniform1f(uniforms.u_wobble, clamp(options.discWobble, defaults.discWobble, 0, 1.5));
      gl.uniform1f(uniforms.u_syncDrift, clamp(options.syncDrift, defaults.syncDrift, 0, 2));
      gl.uniform1f(uniforms.u_flicker, clamp(options.flicker, defaults.flicker, 0, 0.6));
      gl.uniform1i(uniforms.u_originalAspect, options.originalAspect === false ? 0 : 1);
      gl.uniform1i(uniforms.u_tint, tint);
    },
  });
  if (!output) return input;
  logFilterBackend(
    "Baird Televisor",
    "WebGL2",
    "30 vertical lines at 12.5 pictures/s + neon Nipkow aperture",
  );
  return output;
};

export default defineFilter({
  name: "Baird Televisor",
  func: bairdTelevisor,
  optionTypes,
  defaults,
  options: defaults,
  description:
    "Baird/BBC 30-line vertical mechanical television with a Nipkow-disc raster and modulated neon lamp",
  requiresGL: true,
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 25,
});
