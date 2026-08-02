import { ACTION, ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

const PATTERN = { SENSOR: "SENSOR", SCREEN: "SCREEN", PRINT: "PRINT" };

export const optionTypes = {
  pattern: {
    type: ENUM,
    options: [
      { name: "Sensor grid", value: PATTERN.SENSOR },
      { name: "Screen capture", value: PATTERN.SCREEN },
      { name: "Print rosette", value: PATTERN.PRINT },
    ],
    default: PATTERN.SENSOR,
    desc: "Interference geometry used to resample the image",
  },
  cellSize: {
    type: RANGE,
    range: [1.5, 16],
    step: 0.25,
    default: 4,
    desc: "Camera or scanner sampling-lattice pitch in pixels",
  },
  sourcePitch: {
    type: RANGE,
    range: [1, 16],
    step: 0.25,
    default: 3.5,
    desc: "Underlying display-emitter or print-screen pitch in pixels",
  },
  angle: {
    type: RANGE,
    range: [-90, 90],
    step: 0.25,
    default: 7,
    desc: "Rotation of the sampling lattice relative to the source lattice",
  },
  strength: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.7,
    desc: "Blend between the original and physically resampled capture",
  },
  chroma: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.65,
    desc: "Visibility of RGB emitter or CMYK screen separation",
  },
  opticalBlur: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.2,
    desc: "Capture-aperture averaging before lattice sampling",
  },
  drift: {
    type: RANGE,
    range: [0, 4],
    step: 0.05,
    default: 0.25,
    desc: "Animated subpixel motion of the sampling lattice",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Preview frame rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Preview sampling-lattice motion at the selected frame rate",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    },
  },
};

export const defaults = {
  pattern: optionTypes.pattern.default,
  cellSize: optionTypes.cellSize.default,
  sourcePitch: optionTypes.sourcePitch.default,
  angle: optionTypes.angle.default,
  strength: optionTypes.strength.default,
  chroma: optionTypes.chroma.default,
  opticalBlur: optionTypes.opticalBlur.default,
  drift: optionTypes.drift.default,
  animSpeed: optionTypes.animSpeed.default,
};

type MoireOptions = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_cellSize;
uniform float u_sourcePitch;
uniform float u_angle;
uniform float u_strength;
uniform float u_chroma;
uniform float u_opticalBlur;
uniform float u_phase;
uniform int u_pattern;

vec2 rotate2(vec2 p, float angle) {
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c) * p;
}

vec2 uvAt(vec2 p) {
  vec2 q = clamp(p, vec2(0.5), u_res - vec2(0.5));
  return vec2(q.x / u_res.x, 1.0 - q.y / u_res.y);
}

vec4 sampleBilinear(vec2 p) {
  vec2 q = clamp(p - vec2(0.5), vec2(0.0), u_res - vec2(1.0));
  vec2 p0 = floor(q);
  vec2 f = q - p0;
  vec4 a = texture(u_source, uvAt(p0 + vec2(0.5)));
  vec4 b = texture(u_source, uvAt(p0 + vec2(1.5, 0.5)));
  vec4 c = texture(u_source, uvAt(p0 + vec2(0.5, 1.5)));
  vec4 d = texture(u_source, uvAt(p0 + vec2(1.5)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float halftoneDot(vec2 p, float angle, float coverage) {
  if (coverage <= 0.0) return 0.0;
  vec2 local = fract(rotate2(p, angle) / max(u_sourcePitch, 1.0)) - 0.5;
  float radius = sqrt(clamp(coverage, 0.0, 1.0) * 0.5);
  float antialias = max(fwidth(length(local)), 0.015);
  return 1.0 - smoothstep(radius - antialias, radius + antialias, length(local));
}

vec3 displayEmitter(vec2 p, vec3 source) {
  vec2 local = fract(p / max(u_sourcePitch, 1.0));
  float stripe = floor(local.x * 3.0);
  float aperture = step(0.06, local.y) * step(local.y, 0.94)
    * step(0.08, fract(local.x * 3.0)) * step(fract(local.x * 3.0), 0.92);
  vec3 mask = stripe < 1.0 ? vec3(3.0, 0.0, 0.0)
    : stripe < 2.0 ? vec3(0.0, 3.0, 0.0)
    : vec3(0.0, 0.0, 3.0);
  vec3 emitted = source * mask * aperture;
  return mix(source, emitted, u_chroma);
}

vec3 processPrint(vec2 p, vec3 source) {
  float k = min(min(1.0 - source.r, 1.0 - source.g), 1.0 - source.b) * 0.7;
  float denom = max(1.0 - k, 1e-4);
  float c = clamp((1.0 - source.r - k) / denom, 0.0, 1.0);
  float m = clamp((1.0 - source.g - k) / denom, 0.0, 1.0);
  float y = clamp((1.0 - source.b - k) / denom, 0.0, 1.0);
  float dc = halftoneDot(p, radians(15.0), c);
  float dm = halftoneDot(p, radians(75.0), m);
  float dy = halftoneDot(p, radians(0.0), y);
  float dk = halftoneDot(p, radians(45.0), k);
  vec3 paper = vec3(0.96, 0.94, 0.88);
  vec3 colored = paper;
  colored *= mix(vec3(1.0), vec3(0.06, 0.62, 0.72), dc);
  colored *= mix(vec3(1.0), vec3(0.76, 0.10, 0.48), dm);
  colored *= mix(vec3(1.0), vec3(0.94, 0.80, 0.08), dy);
  colored *= mix(vec3(1.0), vec3(0.04), dk);
  float grayCoverage = dot(vec4(dc, dm, dy, dk), vec4(0.22, 0.28, 0.12, 0.38));
  vec3 neutral = mix(paper, vec3(0.04), clamp(grayCoverage, 0.0, 1.0));
  return mix(neutral, colored, u_chroma);
}

vec3 latticeSignal(vec2 p) {
  vec3 source = sampleBilinear(p).rgb;
  if (u_pattern == 1) return displayEmitter(p, source);
  if (u_pattern == 2) return processPrint(p, source);
  return source;
}

vec3 capturedSignal(vec2 p) {
  float radius = u_opticalBlur * u_cellSize * 0.35;
  vec3 center = latticeSignal(p);
  vec3 cross = latticeSignal(p + vec2(radius, 0.0))
    + latticeSignal(p - vec2(radius, 0.0))
    + latticeSignal(p + vec2(0.0, radius))
    + latticeSignal(p - vec2(0.0, radius));
  return mix(center, cross * 0.25, u_opticalBlur);
}

void main() {
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 center = u_res * 0.5;
  vec2 phase = vec2(u_phase, u_phase * 0.6180339);
  vec2 grid = rotate2(pixel - center, u_angle) + phase;
  vec2 snappedGrid = (floor(grid / u_cellSize) + 0.5) * u_cellSize - phase;
  vec2 snapped = rotate2(snappedGrid, -u_angle) + center;
  vec4 original = sampleBilinear(pixel);
  vec3 sampled = capturedSignal(snapped);
  fragColor = vec4(clamp(mix(original.rgb, sampled, u_strength), 0.0, 1.0), original.a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source",
    "u_res",
    "u_cellSize",
    "u_sourcePitch",
    "u_angle",
    "u_strength",
    "u_chroma",
    "u_opticalBlur",
    "u_phase",
    "u_pattern",
  ] as const);
  return _prog;
};

const patternId: Record<string, number> = { SENSOR: 0, SCREEN: 1, PRINT: 2 };

const moireAliasing = (input: any, options: MoireOptions = defaults) => {
  const resolved = { ...defaults, ...options };
  const W = input.width,
    H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "moireAliasing:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  drawPass(
    gl,
    null,
    W,
    H,
    prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.uniform2f(prog.uniforms.u_res, W, H);
      gl.uniform1f(prog.uniforms.u_cellSize, Number(resolved.cellSize));
      gl.uniform1f(prog.uniforms.u_sourcePitch, Number(resolved.sourcePitch));
      gl.uniform1f(prog.uniforms.u_angle, (Number(resolved.angle) * Math.PI) / 180);
      gl.uniform1f(prog.uniforms.u_strength, Number(resolved.strength));
      gl.uniform1f(prog.uniforms.u_chroma, Number(resolved.chroma));
      gl.uniform1f(prog.uniforms.u_opticalBlur, Number(resolved.opticalBlur));
      gl.uniform1f(
        prog.uniforms.u_phase,
        Number(resolved._frameIndex ?? 0) * Number(resolved.drift),
      );
      gl.uniform1i(prog.uniforms.u_pattern, patternId[String(resolved.pattern)] ?? 0);
    },
    vao,
  );
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Moiré / Aliasing", "WebGL2", `${resolved.pattern} cell=${resolved.cellSize}`);
  return output;
};

export default defineFilter({
  name: "Moiré / Aliasing",
  func: moireAliasing,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Lattice-derived capture aliasing from rotated scene sampling, RGB display emitters, or conventional CMYK print screens",
  temporal: true,
  requiresGL: true,
});
