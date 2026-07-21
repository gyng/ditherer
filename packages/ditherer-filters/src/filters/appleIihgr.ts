import { ENUM, RANGE } from "../constants/controlTypes";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

const PHASE_AUTO = "AUTO";
const PHASE_PURPLE_GREEN = "PURPLE_GREEN";
const PHASE_BLUE_ORANGE = "BLUE_ORANGE";
const MONITOR_COLOR = "COLOR";
const MONITOR_GREEN = "GREEN";
const MONITOR_MONO = "MONO";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Luminance threshold that sets each 280×192 HGR picture element" },
  dither: { type: RANGE, range: [0, 1], step: 0.01, default: 0.42, desc: "Ordered pre-dither used when converting continuous-tone images into the one-bit HGR dot stream" },
  phase: {
    type: ENUM,
    options: [
      { name: "Automatic per 7-dot byte", value: PHASE_AUTO },
      { name: "Purple / green", value: PHASE_PURPLE_GREEN },
      { name: "Blue / orange", value: PHASE_BLUE_ORANGE },
    ],
    default: PHASE_AUTO,
    desc: "HGR byte bit 7 delays its seven data dots by half a color-clock, selecting the complementary artifact pair",
  },
  monitor: {
    type: ENUM,
    options: [
      { name: "NTSC color", value: MONITOR_COLOR },
      { name: "Apple green monitor", value: MONITOR_GREEN },
      { name: "Monochrome", value: MONITOR_MONO },
    ],
    default: MONITOR_COLOR,
    desc: "Display decoder: NTSC artifact color or the common monochrome monitor alternatives",
  },
  colorBleed: { type: RANGE, range: [0, 0.5], step: 0.01, default: 0.08, desc: "Horizontal NTSC color-bandwidth blend after exact HGR dot decoding" },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  dither: optionTypes.dither.default,
  phase: optionTypes.phase.default,
  monitor: optionTypes.monitor.default,
  colorBleed: optionTypes.colorBleed.default,
};

type AppleHgrOptions = FilterOptionValues & Partial<typeof defaults>;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_threshold;
uniform float u_dither;
uniform int u_phaseMode;
uniform int u_monitor;
uniform float u_bleed;

const vec3 BLACK = vec3(0.0);
const vec3 WHITE = vec3(1.0);
const vec3 PURPLE = vec3(208.0, 64.0, 255.0) / 255.0;
const vec3 GREEN = vec3(64.0, 220.0, 64.0) / 255.0;
const vec3 BLUE = vec3(64.0, 128.0, 255.0) / 255.0;
const vec3 ORANGE = vec3(255.0, 128.0, 32.0) / 255.0;

vec3 sourceAt(float x, float y) {
  float sx = (clamp(x, 0.0, 279.0) + 0.5) / 280.0;
  float sy = 1.0 - (clamp(y, 0.0, 191.0) + 0.5) / 192.0;
  return texture(u_source, vec2(sx, sy)).rgb;
}

float bitAt(float x, float y) {
  if (x < 0.0 || x >= 280.0) return 0.0;
  vec3 rgb = sourceAt(x, y);
  int bx = int(mod(x, 4.0));
  int by = int(mod(y, 4.0));
  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  float offset = (BAYER[by * 4 + bx] / 16.0 - 0.5) * u_dither * 0.7;
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722)) >= u_threshold + offset ? 1.0 : 0.0;
}

float phaseAt(float x, float y) {
  if (u_phaseMode == 1) return 0.0;
  if (u_phaseMode == 2) return 1.0;
  float byteStart = floor(x / 7.0) * 7.0;
  float phase0Error = 0.0;
  float phase1Error = 0.0;
  for (int index = 0; index < 7; index++) {
    float px = byteStart + float(index);
    vec3 src = sourceAt(px, y);
    bool even = mod(px, 2.0) < 1.0;
    vec3 c0 = even ? PURPLE : GREEN;
    vec3 c1 = even ? BLUE : ORANGE;
    phase0Error += dot(src - c0, src - c0);
    phase1Error += dot(src - c1, src - c1);
  }
  return phase1Error < phase0Error ? 1.0 : 0.0;
}

vec3 artifactAt(float x, float y) {
  if (bitAt(x, y) < 0.5) return BLACK;
  if (bitAt(x - 1.0, y) > 0.5 || bitAt(x + 1.0, y) > 0.5) return WHITE;
  bool even = mod(x, 2.0) < 1.0;
  bool delayed = phaseAt(x, y) > 0.5;
  return delayed ? (even ? BLUE : ORANGE) : (even ? PURPLE : GREEN);
}

void main() {
  float jsX = floor(v_uv.x * u_res.x);
  float jsY = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float x = floor(jsX * 280.0 / u_res.x);
  float y = floor(jsY * 192.0 / u_res.y);
  vec3 rgb = artifactAt(x, y);
  if (u_bleed > 0.0) {
    rgb = mix(rgb, (artifactAt(x - 1.0, y) + artifactAt(x + 1.0, y)) * 0.5, u_bleed);
  }
  if (u_monitor == 1) {
    float level = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = vec3(0.10, 1.0, 0.18) * level;
  } else if (u_monitor == 2) {
    rgb = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

const finiteClamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const number = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(number) ? number : fallback));
};

const appleIihgr = (input: FilterCanvas, options: AppleHgrOptions = defaults): FilterCanvas => {
  const phase = options.phase === PHASE_PURPLE_GREEN ? 1 : options.phase === PHASE_BLUE_ORANGE ? 2 : 0;
  const monitor = options.monitor === MONITOR_GREEN ? 1 : options.monitor === MONITOR_MONO ? 2 : 0;
  const output = renderGLSinglePass({
    source: input,
    width: input.width,
    height: input.height,
    key: "apple-ii-hgr:v1",
    fragmentShader: FS,
    uniformNames: ["u_threshold", "u_dither", "u_phaseMode", "u_monitor", "u_bleed"],
    setUniforms: (gl, uniforms) => {
      gl.uniform1f(uniforms.u_threshold, finiteClamp(options.threshold, defaults.threshold, 0, 1));
      gl.uniform1f(uniforms.u_dither, finiteClamp(options.dither, defaults.dither, 0, 1));
      gl.uniform1i(uniforms.u_phaseMode, phase);
      gl.uniform1i(uniforms.u_monitor, monitor);
      gl.uniform1f(uniforms.u_bleed, finiteClamp(options.colorBleed, defaults.colorBleed, 0, 0.5));
    },
  });
  if (!output) return input;
  logFilterBackend("Apple II HGR", "WebGL2", "280x192 seven-dot bytes + NTSC half-dot phase");
  return output;
};

export default defineFilter({
  name: "Apple II HGR",
  func: appleIihgr,
  optionTypes,
  defaults,
  options: defaults,
  description: "Apple II high-resolution bitmap decoded through its phase-dependent NTSC artifact-color rules",
  requiresGL: true,
});
