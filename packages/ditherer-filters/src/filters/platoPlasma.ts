import { BOOL, RANGE } from "../constants/controlTypes";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

export const optionTypes = {
  threshold: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.46,
    desc: "Luminance needed to address a gas-discharge cell",
  },
  dither: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.38,
    desc: "Ordered 4×4 threshold modulation used to translate continuous tones into bistable cells",
  },
  dotBloom: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 0.85,
    desc: "Orange-neon halo surrounding each addressed electrode intersection",
  },
  electrodeGrid: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.28,
    desc: "Visibility of the fine 512×512 horizontal and vertical electrode structure",
  },
  glassTint: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.42,
    desc: "Warm reflected light in the translucent glass panel",
  },
  microficheUnderlay: {
    type: RANGE,
    range: [0, 0.8],
    step: 0.05,
    default: 0,
    desc: "Optional color-image underlay, recalling PLATO's rear-projected microfiche overlay",
  },
  invert: {
    type: BOOL,
    default: false,
    desc: "Address dark source regions instead of bright regions",
  },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  dither: optionTypes.dither.default,
  dotBloom: optionTypes.dotBloom.default,
  electrodeGrid: optionTypes.electrodeGrid.default,
  glassTint: optionTypes.glassTint.default,
  microficheUnderlay: optionTypes.microficheUnderlay.default,
  invert: optionTypes.invert.default,
};

type PlatoOptions = FilterOptionValues & Partial<typeof defaults>;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_threshold;
uniform float u_dither;
uniform float u_bloom;
uniform float u_grid;
uniform float u_glass;
uniform float u_underlay;
uniform int u_invert;

const float BAYER[16] = float[16](
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0
);

vec3 sourceAt(vec2 logical) {
  vec2 uv = (clamp(logical, vec2(0.0), vec2(511.0)) + 0.5) / 512.0;
  return texture(u_source, vec2(uv.x, 1.0 - uv.y)).rgb;
}

float cellAt(vec2 logical) {
  vec2 cell = floor(logical);
  vec3 rgb = sourceAt(cell);
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  if (u_invert == 1) luma = 1.0 - luma;
  int bx = int(mod(cell.x, 4.0));
  int by = int(mod(cell.y, 4.0));
  float threshold = u_threshold + (BAYER[by * 4 + bx] / 16.0 - 0.5) * u_dither;
  return luma >= threshold ? 1.0 : 0.0;
}

void main() {
  vec2 js = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  float panelSize = min(u_res.x, u_res.y);
  vec2 origin = (u_res - vec2(panelSize)) * 0.5;
  vec2 panel = (js - origin) / panelSize;
  if (panel.x < 0.0 || panel.y < 0.0 || panel.x >= 1.0 || panel.y >= 1.0) {
    fragColor = vec4(vec3(0.012, 0.009, 0.006), 1.0);
    return;
  }
  vec2 logical = panel * 512.0;
  vec2 cell = floor(logical);
  vec2 within = fract(logical) - 0.5;
  float lit = cellAt(cell);
  float halo = lit * exp(-dot(within, within) * 8.0);
  halo += (cellAt(cell + vec2(1.0, 0.0)) + cellAt(cell - vec2(1.0, 0.0))
    + cellAt(cell + vec2(0.0, 1.0)) + cellAt(cell - vec2(0.0, 1.0))) * 0.055 * u_bloom;
  float electrode = smoothstep(0.42, 0.49, max(abs(within.x), abs(within.y)));
  vec3 underlay = sourceAt(cell) * vec3(0.56, 0.48, 0.36) * u_underlay;
  vec3 glass = vec3(0.035, 0.018, 0.006) * (0.35 + u_glass);
  vec3 neon = vec3(1.0, 0.285, 0.035) * (lit * 0.52 + halo * (0.72 + u_bloom * 0.48));
  vec3 color = glass + underlay + neon;
  color *= 1.0 - electrode * u_grid * 0.62;
  float edge = 1.0 - smoothstep(0.42, 0.71, length(panel - 0.5));
  color *= 0.72 + edge * 0.28;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const clamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const parsed = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(parsed) ? parsed : fallback));
};

const platoPlasma = (input: FilterCanvas, options: PlatoOptions = defaults): FilterCanvas => {
  const output = renderGLSinglePass({
    source: input,
    width: input.width,
    height: input.height,
    key: "plato-plasma:v1",
    fragmentShader: FS,
    uniformNames: [
      "u_threshold",
      "u_dither",
      "u_bloom",
      "u_grid",
      "u_glass",
      "u_underlay",
      "u_invert",
    ],
    setUniforms: (gl, uniforms) => {
      gl.uniform1f(uniforms.u_threshold, clamp(options.threshold, defaults.threshold, 0, 1));
      gl.uniform1f(uniforms.u_dither, clamp(options.dither, defaults.dither, 0, 1));
      gl.uniform1f(uniforms.u_bloom, clamp(options.dotBloom, defaults.dotBloom, 0, 2));
      gl.uniform1f(uniforms.u_grid, clamp(options.electrodeGrid, defaults.electrodeGrid, 0, 1));
      gl.uniform1f(uniforms.u_glass, clamp(options.glassTint, defaults.glassTint, 0, 1));
      gl.uniform1f(
        uniforms.u_underlay,
        clamp(options.microficheUnderlay, defaults.microficheUnderlay, 0, 0.8),
      );
      gl.uniform1i(uniforms.u_invert, options.invert === true ? 1 : 0);
    },
  });
  if (!output) return input;
  logFilterBackend("PLATO Plasma", "WebGL2", "512x512 bistable neon-gas electrode grid");
  return output;
};

export default defineFilter({
  name: "PLATO Plasma",
  func: platoPlasma,
  optionTypes,
  defaults,
  options: defaults,
  description:
    "Control Data PLATO CC546: a square 512×512 bistable orange-neon plasma panel with optional microfiche underlay",
  requiresGL: true,
});
