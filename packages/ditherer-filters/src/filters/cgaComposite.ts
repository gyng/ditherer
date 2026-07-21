import { ENUM, RANGE } from "../constants/controlTypes";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

const MODE_COMPOSITE = "COMPOSITE";
const MODE_PALETTE_0 = "PALETTE_0";
const MODE_PALETTE_1 = "PALETTE_1";
const MODE_RGBI = "RGBI";

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Composite artifact color", value: MODE_COMPOSITE },
    { name: "320×200 cyan / magenta", value: MODE_PALETTE_0 },
    { name: "320×200 red / green", value: MODE_PALETTE_1 },
    { name: "RGBI 16-color", value: MODE_RGBI },
  ], default: MODE_COMPOSITE, desc: "CGA output path: phase-sensitive television composite or legal direct-drive RGBI palettes" },
  hue: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Composite decoder reference phase; rotates artifact colors without changing the bitstream" },
  saturation: { type: RANGE, range: [0, 2], step: 0.05, default: 1.15, desc: "NTSC chroma-demodulation gain for composite artifact colors" },
  monitorBandwidth: { type: RANGE, range: [0.2, 1], step: 0.05, default: 0.58, desc: "Television luma/chroma bandwidth; lower values blend more adjacent carrier pixels" },
  blackLevel: { type: RANGE, range: [-0.2, 0.2], step: 0.01, default: 0, desc: "Composite monitor setup and brightness offset" },
  scanlineStrength: { type: RANGE, range: [0, 0.6], step: 0.02, default: 0.12, desc: "Darkening between the 200 active CGA raster rows" },
};

export const defaults = {
  mode: optionTypes.mode.default,
  hue: optionTypes.hue.default,
  saturation: optionTypes.saturation.default,
  monitorBandwidth: optionTypes.monitorBandwidth.default,
  blackLevel: optionTypes.blackLevel.default,
  scanlineStrength: optionTypes.scanlineStrength.default,
};

type CgaOptions = FilterOptionValues & Partial<typeof defaults>;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_hue;
uniform float u_saturation;
uniform float u_bandwidth;
uniform float u_blackLevel;
uniform float u_scanlines;

vec3 sourceAt(float x, float y, float width) {
  return texture(u_source, vec2((clamp(x, 0.0, width - 1.0) + 0.5) / width, 1.0 - (clamp(y, 0.0, 199.0) + 0.5) / 200.0)).rgb;
}

vec3 rgbi(int index) {
  float intensity = (index & 8) != 0 ? 1.0 : 0.6667;
  vec3 color = vec3((index & 4) != 0 ? intensity : 0.0, (index & 2) != 0 ? intensity : 0.0, (index & 1) != 0 ? intensity : 0.0);
  if (index == 6) color.g *= 0.5;
  if (index == 8) color = vec3(0.3333);
  if (index == 7) color = vec3(0.6667);
  if (index == 15) color = vec3(1.0);
  return color;
}

vec3 nearestRgbi(vec3 source) {
  vec3 best = vec3(0.0);
  float bestError = 1e10;
  for (int index = 0; index < 16; index++) {
    vec3 candidate = rgbi(index);
    float error = dot(source - candidate, source - candidate);
    if (error < bestError) { bestError = error; best = candidate; }
  }
  return best;
}

vec3 nearestFour(vec3 source, int palette) {
  vec3 colors[4];
  colors[0] = vec3(0.0);
  if (palette == 0) {
    colors[1] = vec3(0.0, 0.67, 0.67);
    colors[2] = vec3(0.67, 0.0, 0.67);
  } else {
    colors[1] = vec3(0.0, 0.67, 0.0);
    colors[2] = vec3(0.67, 0.0, 0.0);
  }
  colors[3] = vec3(0.67);
  vec3 best = colors[0];
  float bestError = 1e10;
  for (int index = 0; index < 4; index++) {
    float error = dot(source - colors[index], source - colors[index]);
    if (error < bestError) { bestError = error; best = colors[index]; }
  }
  return best;
}

vec3 rgbToYiq(vec3 rgb) {
  return vec3(dot(rgb, vec3(0.299, 0.587, 0.114)), dot(rgb, vec3(0.596, -0.274, -0.322)), dot(rgb, vec3(0.211, -0.523, 0.312)));
}

float encodedBit(float x, float y) {
  float macroX = floor(x / 4.0);
  vec3 source = sourceAt(macroX, y, 160.0);
  int bestPattern = 0;
  float bestError = 1e10;
  for (int pattern = 0; pattern < 16; pattern++) {
    float b0 = (pattern & 1) != 0 ? 1.0 : 0.0;
    float b1 = (pattern & 2) != 0 ? 1.0 : 0.0;
    float b2 = (pattern & 4) != 0 ? 1.0 : 0.0;
    float b3 = (pattern & 8) != 0 ? 1.0 : 0.0;
    float yy = (b0 + b1 + b2 + b3) * 0.25;
    float ii = (b0 - b2) * 0.22;
    float qq = (b1 - b3) * 0.22;
    vec3 candidate = clamp(vec3(
      yy + 0.956 * ii + 0.621 * qq,
      yy - 0.272 * ii - 0.647 * qq,
      yy - 1.106 * ii + 1.703 * qq
    ), 0.0, 1.0);
    float error = dot(source - candidate, source - candidate);
    if (error < bestError) { bestError = error; bestPattern = pattern; }
  }
  int carrierPhase = int(mod(floor(x), 4.0));
  return (bestPattern & (1 << carrierPhase)) != 0 ? 1.0 : 0.0;
}

vec3 decodeComposite(float x, float y) {
  float luma = 0.0;
  float weight = 0.0;
  float radius = mix(4.0, 1.0, u_bandwidth);
  for (int tap = -4; tap <= 4; tap++) {
    float w = max(0.0, radius + 1.0 - abs(float(tap)));
    luma += encodedBit(x + float(tap), y) * w;
    weight += w;
  }
  luma /= max(weight, 1.0);
  float i = 0.0;
  float q = 0.0;
  float chromaWeight = 0.0;
  for (int tap = -4; tap <= 4; tap++) {
    float w = max(0.0, 5.0 - abs(float(tap)));
    float phase = mod(floor(x + float(tap)), 4.0) * 1.5707963 + u_hue;
    float centered = encodedBit(x + float(tap), y) - luma;
    i += centered * cos(phase) * w;
    q += centered * sin(phase) * w;
    chromaWeight += w;
  }
  i = i / max(chromaWeight, 1.0) * 0.85 * u_saturation;
  q = q / max(chromaWeight, 1.0) * 0.85 * u_saturation;
  float yy = luma + u_blackLevel;
  return vec3(yy + 0.956 * i + 0.621 * q, yy - 0.272 * i - 0.647 * q, yy - 1.106 * i + 1.703 * q);
}

void main() {
  float jsX = floor(v_uv.x * u_res.x);
  float jsY = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float rasterY = floor(jsY * 200.0 / u_res.y);
  vec3 color;
  if (u_mode == 0) {
    float rasterX = floor(jsX * 640.0 / u_res.x);
    color = decodeComposite(rasterX, rasterY);
  } else {
    float rasterX = floor(jsX * 320.0 / u_res.x);
    vec3 source = sourceAt(rasterX, rasterY, 320.0);
    color = u_mode == 3 ? nearestRgbi(source) : nearestFour(source, u_mode - 1);
  }
  float rowPhase = fract(jsY * 200.0 / u_res.y);
  color *= 1.0 - u_scanlines * (1.0 - smoothstep(0.0, 0.18, min(rowPhase, 1.0 - rowPhase)));
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const clamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const parsed = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(parsed) ? parsed : fallback));
};

const cgaComposite = (input: FilterCanvas, options: CgaOptions = defaults): FilterCanvas => {
  const mode = options.mode === MODE_PALETTE_0 ? 1 : options.mode === MODE_PALETTE_1 ? 2 : options.mode === MODE_RGBI ? 3 : 0;
  const output = renderGLSinglePass({
    source: input,
    width: input.width,
    height: input.height,
    key: "cga-composite:v1",
    fragmentShader: FS,
    uniformNames: ["u_mode", "u_hue", "u_saturation", "u_bandwidth", "u_blackLevel", "u_scanlines"],
    setUniforms: (gl, uniforms) => {
      gl.uniform1i(uniforms.u_mode, mode);
      gl.uniform1f(uniforms.u_hue, clamp(options.hue, defaults.hue, -180, 180) * Math.PI / 180);
      gl.uniform1f(uniforms.u_saturation, clamp(options.saturation, defaults.saturation, 0, 2));
      gl.uniform1f(uniforms.u_bandwidth, clamp(options.monitorBandwidth, defaults.monitorBandwidth, 0.2, 1));
      gl.uniform1f(uniforms.u_blackLevel, clamp(options.blackLevel, defaults.blackLevel, -0.2, 0.2));
      gl.uniform1f(uniforms.u_scanlines, clamp(options.scanlineStrength, defaults.scanlineStrength, 0, 0.6));
    },
  });
  if (!output) return input;
  logFilterBackend("CGA Composite", "WebGL2", mode === 0 ? "640-carrier-pixel NTSC artifact decode" : "legal CGA direct-drive palette");
  return output;
};

export default defineFilter({
  name: "CGA Composite",
  func: cgaComposite,
  optionTypes,
  defaults,
  options: defaults,
  description: "IBM CGA graphics through legal RGBI palettes or a phase-sensitive NTSC composite artifact-color decoder",
  requiresGL: true,
});
