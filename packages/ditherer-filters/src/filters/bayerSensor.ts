import { ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glUnavailableStub,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

const CFA = { RGGB: "RGGB", BGGR: "BGGR", GRBG: "GRBG", GBRG: "GBRG" };
const METHOD = { NEAREST: "NEAREST", BILINEAR: "BILINEAR", EDGE_AWARE: "EDGE_AWARE" };

export const optionTypes = {
  cfa: {
    type: ENUM,
    options: Object.values(CFA).map((value) => ({ name: value, value })),
    default: CFA.RGGB,
    desc: "Color-filter-array layout across each 2×2 sensor cell",
  },
  method: {
    type: ENUM,
    options: [
      { name: "Nearest", value: METHOD.NEAREST },
      { name: "Bilinear", value: METHOD.BILINEAR },
      { name: "Edge aware", value: METHOD.EDGE_AWARE },
    ],
    default: METHOD.EDGE_AWARE,
    desc: "Demosaic reconstruction method",
  },
  sensorNoise: { type: RANGE, range: [0, 0.2], step: 0.005, default: 0.025, desc: "Per-photosite electronic noise" },
  hotPixels: { type: RANGE, range: [0, 0.02], step: 0.0005, default: 0.001, desc: "Probability of saturated or dead photosites" },
  colorBleed: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Blend reconstructed chroma across neighboring photosites" },
};

export const defaults = {
  cfa: optionTypes.cfa.default,
  method: optionTypes.method.default,
  sensorNoise: optionTypes.sensorNoise.default,
  hotPixels: optionTypes.hotPixels.default,
  colorBleed: optionTypes.colorBleed.default,
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_cfa;
uniform int u_method;
uniform float u_noise;
uniform float u_hotPixels;
uniform float u_colorBleed;

vec2 uvAt(vec2 p) {
  vec2 q = clamp(floor(p) + 0.5, vec2(0.5), u_res - vec2(0.5));
  return vec2(q.x / u_res.x, 1.0 - q.y / u_res.y);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

int baseColor(int x, int y) {
  int cell = (y & 1) * 2 + (x & 1);
  if (u_cfa == 0) { int v[4] = int[4](0, 1, 1, 2); return v[cell]; }
  if (u_cfa == 1) { int v[4] = int[4](2, 1, 1, 0); return v[cell]; }
  if (u_cfa == 2) { int v[4] = int[4](1, 0, 2, 1); return v[cell]; }
  int v[4] = int[4](1, 2, 0, 1); return v[cell];
}

float rawAt(vec2 p) {
  vec2 q = clamp(floor(p), vec2(0.0), u_res - vec2(1.0));
  vec3 c = texture(u_source, uvAt(q)).rgb;
  int channel = baseColor(int(q.x), int(q.y));
  float raw = channel == 0 ? c.r : channel == 1 ? c.g : c.b;
  raw += (hash12(q + 17.0) - 0.5) * u_noise;
  float defect = hash12(q * 19.17 + 3.1);
  if (defect < u_hotPixels * 0.65) raw = 1.0;
  else if (defect < u_hotPixels) raw = 0.0;
  return clamp(raw, 0.0, 1.0);
}

float interpolateChannel(vec2 p, int target) {
  if (baseColor(int(p.x), int(p.y)) == target) return rawAt(p);
  float value = 0.0;
  float weights = 0.0;
  float bestDistance = 99.0;
  float nearestValue = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 q = p + vec2(float(dx), float(dy));
      vec2 qc = clamp(q, vec2(0.0), u_res - vec2(1.0));
      if (baseColor(int(qc.x), int(qc.y)) != target) continue;
      float distance = abs(float(dx)) + abs(float(dy));
      float sampleValue = rawAt(qc);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearestValue = sampleValue;
      }
      float weight = 1.0 / (1.0 + distance);
      value += sampleValue * weight;
      weights += weight;
    }
  }
  if (u_method == 0) return nearestValue;
  return weights > 0.0 ? value / weights : rawAt(p);
}

void main() {
  vec2 pixel = vec2(floor(v_uv.x * u_res.x), u_res.y - 1.0 - floor(v_uv.y * u_res.y));
  float r = interpolateChannel(pixel, 0);
  float g = interpolateChannel(pixel, 1);
  float b = interpolateChannel(pixel, 2);
  if (u_method == 2 && baseColor(int(pixel.x), int(pixel.y)) != 1) {
    float left = rawAt(pixel + vec2(-1.0, 0.0));
    float right = rawAt(pixel + vec2(1.0, 0.0));
    float up = rawAt(pixel + vec2(0.0, -1.0));
    float down = rawAt(pixel + vec2(0.0, 1.0));
    float horizontalGradient = abs(left - right);
    float verticalGradient = abs(up - down);
    g = horizontalGradient < verticalGradient ? (left + right) * 0.5 : (up + down) * 0.5;
  }
  vec3 reconstructed = vec3(r, g, b);
  float luma = dot(reconstructed, vec3(0.2126, 0.7152, 0.0722));
  reconstructed = mix(reconstructed, vec3(luma) + (reconstructed - vec3(luma)) * 0.65, u_colorBleed);
  fragColor = vec4(clamp(reconstructed, 0.0, 1.0), 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_cfa", "u_method", "u_noise", "u_hotPixels", "u_colorBleed",
  ] as const);
  return _prog;
};

const cfaId: Record<string, number> = { RGGB: 0, BGGR: 1, GRBG: 2, GBRG: 3 };
const methodId: Record<string, number> = { NEAREST: 0, BILINEAR: 1, EDGE_AWARE: 2 };

const bayerSensor = (input: any, options = defaults) => {
  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "bayerSensor:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1i(prog.uniforms.u_cfa, cfaId[options.cfa] ?? 0);
    gl.uniform1i(prog.uniforms.u_method, methodId[options.method] ?? 2);
    gl.uniform1f(prog.uniforms.u_noise, options.sensorNoise);
    gl.uniform1f(prog.uniforms.u_hotPixels, options.hotPixels);
    gl.uniform1f(prog.uniforms.u_colorBleed, options.colorBleed);
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Bayer Sensor", "WebGL2", `${options.cfa} ${options.method}`);
  return output;
};

export default defineFilter({
  name: "Bayer Sensor",
  func: bayerSensor,
  optionTypes,
  options: defaults,
  defaults,
  description: "Simulate a camera color-filter array, demosaic reconstruction, sensor noise, and defective photosites",
  requiresGL: true,
});
