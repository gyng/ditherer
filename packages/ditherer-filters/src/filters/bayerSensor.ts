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
      { name: "Gradient-corrected 5×5", value: METHOD.EDGE_AWARE },
    ],
    default: METHOD.EDGE_AWARE,
    desc: "Nearest, true bilinear, or Malvar-He-Cutler gradient-corrected reconstruction",
  },
  sensorNoise: { type: RANGE, range: [0, 0.2], step: 0.002, default: 0.025, desc: "Signal-dependent shot-noise coefficient at a full-scale photosite" },
  readNoise: { type: RANGE, range: [0, 0.05], step: 0.001, default: 0.004, desc: "Signal-independent electronic read-noise floor" },
  hotPixels: { type: RANGE, range: [0, 0.02], step: 0.0005, default: 0.001, desc: "Stable probability of saturated or dead photosites" },
  colorBleed: { type: RANGE, range: [0, 0.5], step: 0.01, default: 0.08, desc: "Optical/electrical photosite crosstalk applied before demosaicing" },
  opticalBlur: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Sensor optical low-pass filtering before CFA sampling" },
};

export const defaults = {
  cfa: optionTypes.cfa.default,
  method: optionTypes.method.default,
  sensorNoise: optionTypes.sensorNoise.default,
  readNoise: optionTypes.readNoise.default,
  hotPixels: optionTypes.hotPixels.default,
  colorBleed: optionTypes.colorBleed.default,
  opticalBlur: optionTypes.opticalBlur.default,
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
uniform float u_readNoise;
uniform float u_hotPixels;
uniform float u_colorBleed;
uniform float u_opticalBlur;
uniform float u_frameSeed;

vec2 uvAt(vec2 p) {
  vec2 q = clamp(floor(p) + 0.5, vec2(0.5), u_res - vec2(0.5));
  return vec2(q.x / u_res.x, 1.0 - q.y / u_res.y);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float gaussian(vec2 p) {
  vec2 seeded = p + vec2(u_frameSeed * 37.13, u_frameSeed * 19.71);
  float u1 = max(1e-6, hash12(seeded + vec2(17.13, 9.71)));
  float u2 = hash12(seeded * 1.913 + vec2(3.17, 21.91));
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}

vec3 srgbToLinear(vec3 c) {
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  vec3 low = v * 12.92;
  vec3 high = 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), v));
}

int baseColor(int x, int y) {
  int cell = (y & 1) * 2 + (x & 1);
  if (u_cfa == 0) { int v[4] = int[4](0, 1, 1, 2); return v[cell]; }
  if (u_cfa == 1) { int v[4] = int[4](2, 1, 1, 0); return v[cell]; }
  if (u_cfa == 2) { int v[4] = int[4](1, 0, 2, 1); return v[cell]; }
  int v[4] = int[4](1, 2, 0, 1); return v[cell];
}

vec3 sourceAt(vec2 p) {
  vec2 q = clamp(floor(p), vec2(0.0), u_res - vec2(1.0));
  vec3 center = srgbToLinear(texture(u_source, uvAt(q)).rgb);
  vec3 cross = srgbToLinear(texture(u_source, uvAt(q + vec2(-1.0, 0.0))).rgb)
    + srgbToLinear(texture(u_source, uvAt(q + vec2(1.0, 0.0))).rgb)
    + srgbToLinear(texture(u_source, uvAt(q + vec2(0.0, -1.0))).rgb)
    + srgbToLinear(texture(u_source, uvAt(q + vec2(0.0, 1.0))).rgb);
  return mix(center, cross * 0.25, u_opticalBlur);
}

float rawAt(vec2 p) {
  vec2 q = clamp(floor(p), vec2(0.0), u_res - vec2(1.0));
  vec3 c = sourceAt(q);
  int channel = baseColor(int(q.x), int(q.y));
  float raw = channel == 0 ? c.r : channel == 1 ? c.g : c.b;
  float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
  raw = mix(raw, luminance, u_colorBleed);
  float sigma = sqrt(max(0.0, raw) * u_noise * u_noise + u_readNoise * u_readNoise);
  raw += gaussian(q) * sigma;
  float defect = hash12(q * 19.17 + 3.1);
  if (defect < u_hotPixels * 0.65) raw = 1.0;
  else if (defect < u_hotPixels) raw = 0.0;
  return clamp(raw, 0.0, 1.0);
}

float nearestChannel(vec2 p, int target) {
  if (baseColor(int(p.x), int(p.y)) == target) return rawAt(p);
  float bestDistance = 99.0;
  float nearestValue = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 q = p + vec2(float(dx), float(dy));
      vec2 qc = clamp(q, vec2(0.0), u_res - vec2(1.0));
      if (baseColor(int(qc.x), int(qc.y)) != target) continue;
      float distance = float(dx * dx + dy * dy);
      float sampleValue = rawAt(qc);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearestValue = sampleValue;
      }
    }
  }
  return nearestValue;
}

float bilinearChannel(vec2 p, int target) {
  int current = baseColor(int(p.x), int(p.y));
  if (current == target) return rawAt(p);
  if (target == 1) {
    return 0.25 * (
      rawAt(p + vec2(-1.0, 0.0)) + rawAt(p + vec2(1.0, 0.0))
      + rawAt(p + vec2(0.0, -1.0)) + rawAt(p + vec2(0.0, 1.0))
    );
  }
  if (current == 1) {
    bool horizontal = baseColor(int(p.x) - 1, int(p.y)) == target;
    return horizontal
      ? 0.5 * (rawAt(p + vec2(-1.0, 0.0)) + rawAt(p + vec2(1.0, 0.0)))
      : 0.5 * (rawAt(p + vec2(0.0, -1.0)) + rawAt(p + vec2(0.0, 1.0)));
  }
  return 0.25 * (
    rawAt(p + vec2(-1.0, -1.0)) + rawAt(p + vec2(1.0, -1.0))
    + rawAt(p + vec2(-1.0, 1.0)) + rawAt(p + vec2(1.0, 1.0))
  );
}

float sameColorAxial2Average(vec2 p) {
  return 0.25 * (
    rawAt(p + vec2(-2.0, 0.0)) + rawAt(p + vec2(2.0, 0.0))
    + rawAt(p + vec2(0.0, -2.0)) + rawAt(p + vec2(0.0, 2.0))
  );
}

float gradientCorrectedChannel(vec2 p, int target) {
  int current = baseColor(int(p.x), int(p.y));
  if (current == target) return rawAt(p);

  if (target == 1) {
    float estimate = bilinearChannel(p, target);
    return estimate + 0.5 * (rawAt(p) - sameColorAxial2Average(p));
  }

  if (current != 1) {
    float estimate = bilinearChannel(p, target);
    return estimate + 0.75 * (rawAt(p) - sameColorAxial2Average(p));
  }

  bool horizontal = baseColor(int(p.x) - 1, int(p.y)) == target;
  float estimate = bilinearChannel(p, target);
  float center = rawAt(p);
  float diagonal = rawAt(p + vec2(-1.0, -1.0)) + rawAt(p + vec2(1.0, -1.0))
    + rawAt(p + vec2(-1.0, 1.0)) + rawAt(p + vec2(1.0, 1.0));
  float primary2 = horizontal
    ? rawAt(p + vec2(-2.0, 0.0)) + rawAt(p + vec2(2.0, 0.0))
    : rawAt(p + vec2(0.0, -2.0)) + rawAt(p + vec2(0.0, 2.0));
  float secondary2 = horizontal
    ? rawAt(p + vec2(0.0, -2.0)) + rawAt(p + vec2(0.0, 2.0))
    : rawAt(p + vec2(-2.0, 0.0)) + rawAt(p + vec2(2.0, 0.0));
  float correction = (5.0 * center - primary2 + 0.5 * secondary2 - diagonal) / 8.0;
  return estimate + correction;
}

float reconstruct(vec2 p, int target) {
  if (u_method == 0) return nearestChannel(p, target);
  if (u_method == 1) return bilinearChannel(p, target);
  return gradientCorrectedChannel(p, target);
}

void main() {
  vec2 pixel = vec2(floor(v_uv.x * u_res.x), u_res.y - 1.0 - floor(v_uv.y * u_res.y));
  vec3 reconstructed = vec3(
    reconstruct(pixel, 0), reconstruct(pixel, 1), reconstruct(pixel, 2)
  );
  float alpha = texture(u_source, uvAt(pixel)).a;
  fragColor = vec4(linearToSrgb(clamp(reconstructed, 0.0, 1.0)), alpha);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_cfa", "u_method", "u_noise", "u_readNoise",
    "u_hotPixels", "u_colorBleed", "u_opticalBlur", "u_frameSeed",
  ] as const);
  return _prog;
};

const cfaId: Record<string, number> = { RGGB: 0, BGGR: 1, GRBG: 2, GBRG: 3 };
const methodId: Record<string, number> = { NEAREST: 0, BILINEAR: 1, EDGE_AWARE: 2 };

type BayerSensorOptions = Partial<typeof defaults> & { _frameIndex?: number };

const bayerSensor = (input: any, options: BayerSensorOptions = defaults) => {
  const resolved = { ...defaults, ...options };
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
    gl.uniform1i(prog.uniforms.u_cfa, cfaId[resolved.cfa] ?? 0);
    gl.uniform1i(prog.uniforms.u_method, methodId[resolved.method] ?? 2);
    gl.uniform1f(prog.uniforms.u_noise, resolved.sensorNoise);
    gl.uniform1f(prog.uniforms.u_readNoise, resolved.readNoise);
    gl.uniform1f(prog.uniforms.u_hotPixels, resolved.hotPixels);
    gl.uniform1f(prog.uniforms.u_colorBleed, resolved.colorBleed);
    gl.uniform1f(prog.uniforms.u_opticalBlur, resolved.opticalBlur);
    gl.uniform1f(prog.uniforms.u_frameSeed, Number(resolved._frameIndex ?? 0));
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Bayer Sensor", "WebGL2", `${resolved.cfa} ${resolved.method}`);
  return output;
};

export default defineFilter({
  name: "Bayer Sensor",
  func: bayerSensor,
  optionTypes,
  options: defaults,
  defaults,
  description: "Bayer CFA capture with true nearest/bilinear or 5×5 gradient-corrected demosaicing, shot/read noise, crosstalk, optical low-pass filtering, and stable defects",
  temporal: true,
  requiresGL: true,
});
