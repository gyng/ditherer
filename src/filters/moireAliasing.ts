import { ACTION, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glUnavailableStub,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

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
  cellSize: { type: RANGE, range: [1.5, 16], step: 0.5, default: 4, desc: "Sampling-grid pitch in pixels" },
  angle: { type: RANGE, range: [-90, 90], step: 1, default: 7, desc: "Rotation between the image and sampling grid" },
  strength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.55, desc: "Amount of grid aliasing and interference" },
  chroma: { type: RANGE, range: [0, 1], step: 0.01, default: 0.35, desc: "Colored fringing between mismatched sampling grids" },
  drift: { type: RANGE, range: [0, 4], step: 0.05, default: 0.25, desc: "Animated phase drift per frame" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Preview frame rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    },
  },
};

export const defaults = {
  pattern: optionTypes.pattern.default,
  cellSize: optionTypes.cellSize.default,
  angle: optionTypes.angle.default,
  strength: optionTypes.strength.default,
  chroma: optionTypes.chroma.default,
  drift: optionTypes.drift.default,
  animSpeed: optionTypes.animSpeed.default,
};

type MoireOptions = FilterOptionValues & typeof defaults & { _frameIndex?: number };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_cellSize;
uniform float u_angle;
uniform float u_strength;
uniform float u_chroma;
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

void main() {
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 center = u_res * 0.5;
  vec2 grid = rotate2(pixel - center, u_angle);
  vec2 snappedGrid = (floor(grid / u_cellSize) + 0.5) * u_cellSize;
  vec2 snapped = rotate2(snappedGrid, -u_angle) + center;
  vec3 original = texture(u_source, uvAt(pixel)).rgb;
  vec3 sampled = texture(u_source, uvAt(snapped)).rgb;

  vec2 cycle = grid / u_cellSize * 6.2831853;
  float interference;
  if (u_pattern == 0) {
    interference = sin(cycle.x + u_phase) * sin(cycle.y * 1.031 - u_phase * 0.7);
  } else if (u_pattern == 1) {
    interference = sin(cycle.x + sin(cycle.y * 0.97) * 1.5 + u_phase);
  } else {
    float a = sin(cycle.x + u_phase);
    float b = sin(cycle.x * 0.5 + cycle.y * 0.866 - u_phase * 0.6);
    float c = sin(-cycle.x * 0.5 + cycle.y * 0.866 + u_phase * 0.4);
    interference = (a + b + c) / 3.0;
  }

  vec2 chromaOffset = vec2(cos(u_angle), -sin(u_angle)) * u_chroma * u_cellSize;
  float r = texture(u_source, uvAt(snapped + chromaOffset)).r;
  float b = texture(u_source, uvAt(snapped - chromaOffset)).b;
  sampled = mix(sampled, vec3(r, sampled.g, b), u_chroma);
  vec3 aliased = sampled * (1.0 + interference * u_strength * 0.22);
  fragColor = vec4(clamp(mix(original, aliased, u_strength), 0.0, 1.0), 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_cellSize", "u_angle", "u_strength",
    "u_chroma", "u_phase", "u_pattern",
  ] as const);
  return _prog;
};

const patternId: Record<string, number> = { SENSOR: 0, SCREEN: 1, PRINT: 2 };

const moireAliasing = (input: any, options: MoireOptions = defaults) => {
  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "moireAliasing:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_cellSize, Number(options.cellSize));
    gl.uniform1f(prog.uniforms.u_angle, Number(options.angle) * Math.PI / 180);
    gl.uniform1f(prog.uniforms.u_strength, Number(options.strength));
    gl.uniform1f(prog.uniforms.u_chroma, Number(options.chroma));
    gl.uniform1f(prog.uniforms.u_phase, Number(options._frameIndex ?? 0) * Number(options.drift));
    gl.uniform1i(prog.uniforms.u_pattern, patternId[String(options.pattern)] ?? 0);
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Moiré / Aliasing", "WebGL2", `${options.pattern} cell=${options.cellSize}`);
  return output;
};

export default defineFilter({
  name: "Moiré / Aliasing",
  func: moireAliasing,
  optionTypes,
  options: defaults,
  defaults,
  description: "Interference from rotated sensor, display, or print sampling grids with colored aliasing",
  requiresGL: true,
});
