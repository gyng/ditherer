import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";

const COLORMAP_IRONBOW = "IRONBOW";
const COLORMAP_RAINBOW = "RAINBOW";
const COLORMAP_WHITE_HOT = "WHITE_HOT";
const COLORMAP_BLACK_HOT = "BLACK_HOT";

const colormaps: Record<string, number[][]> = {
  [COLORMAP_IRONBOW]: [
    [0, 0, 0], [20, 0, 80], [80, 0, 120], [160, 0, 100],
    [220, 60, 20], [255, 180, 0], [255, 255, 100], [255, 255, 255],
  ],
  [COLORMAP_RAINBOW]: [
    [0, 0, 40], [0, 0, 200], [0, 180, 255], [0, 220, 80],
    [200, 220, 0], [255, 120, 0], [255, 0, 0], [255, 255, 255],
  ],
  [COLORMAP_WHITE_HOT]: [
    [0, 0, 0], [30, 30, 30], [80, 80, 80], [130, 130, 130],
    [180, 180, 180], [220, 220, 220], [255, 255, 255],
  ],
  [COLORMAP_BLACK_HOT]: [
    [255, 255, 255], [220, 220, 220], [180, 180, 180], [130, 130, 130],
    [80, 80, 80], [30, 30, 30], [0, 0, 0],
  ],
};

export const optionTypes = {
  colormap: {
    type: ENUM,
    options: [
      { name: "Ironbow", value: COLORMAP_IRONBOW },
      { name: "Rainbow", value: COLORMAP_RAINBOW },
      { name: "White Hot", value: COLORMAP_WHITE_HOT },
      { name: "Black Hot", value: COLORMAP_BLACK_HOT },
    ],
    default: COLORMAP_IRONBOW,
    desc: "Display palette applied to the visible-luminance proxy",
  },
  level: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Center of the visible-proxy display window" },
  span: { type: RANGE, range: [0.05, 1], step: 0.01, default: 0.8, desc: "Width of the visible-proxy display window" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.2, desc: "Display contrast after level/span mapping; not temperature contrast" },
  sensorWidth: { type: RANGE, range: [40, 640], step: 40, default: 160, desc: "Horizontal proxy-sensor resolution; cells remain square" },
  noiseAmount: { type: RANGE, range: [0, 0.15], step: 0.005, default: 0.015, desc: "Frame-varying sensor read noise" },
  fixedPatternNoise: { type: RANGE, range: [0, 0.1], step: 0.005, default: 0.01, desc: "Stable per-detector response variation" },
  crosshair: { type: BOOL, default: true, desc: "Show a center aiming reticle without a temperature readout" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Preview refresh rate for changing sensor noise" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop live sensor-noise preview",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  colormap: optionTypes.colormap.default,
  level: optionTypes.level.default,
  span: optionTypes.span.default,
  contrast: optionTypes.contrast.default,
  sensorWidth: optionTypes.sensorWidth.default,
  noiseAmount: optionTypes.noiseAmount.default,
  fixedPatternNoise: optionTypes.fixedPatternNoise.default,
  crosshair: optionTypes.crosshair.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const MAX_STOPS = 8;

const THERMAL_PROXY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_level;
uniform float u_span;
uniform float u_contrast;
uniform float u_sensorWidth;
uniform float u_noise;
uniform float u_fixedPatternNoise;
uniform float u_frameSeed;
uniform int u_stopCount;
uniform vec3 u_stops[${MAX_STOPS}];
uniform int u_crosshair;
uniform vec3 u_hotColor;

float hash21(vec2 point, float seed) {
  return fract(sin(dot(point, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

vec3 srgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

float visibleLuma(vec2 uv) {
  vec3 linear = srgbToLinear(texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb);
  return dot(linear, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sampleGradient(float value) {
  float position = clamp(value, 0.0, 1.0) * float(u_stopCount - 1);
  int index = int(floor(position));
  if (index >= u_stopCount - 1) return u_stops[u_stopCount - 1];
  return mix(u_stops[index], u_stops[index + 1], position - float(index));
}

void main() {
  vec2 pixel = floor(v_uv * u_res);
  float cellSize = max(1.0, u_res.x / max(1.0, u_sensorWidth));
  vec2 cell = floor(pixel / cellSize);
  vec2 cellCenterPixel = (cell + 0.5) * cellSize;
  vec2 centerUv = cellCenterPixel / u_res;
  vec2 sampleOffset = vec2(cellSize * 0.27) / u_res;

  float luminance = visibleLuma(centerUv) * 0.4;
  luminance += visibleLuma(centerUv + vec2(sampleOffset.x, sampleOffset.y)) * 0.15;
  luminance += visibleLuma(centerUv + vec2(-sampleOffset.x, sampleOffset.y)) * 0.15;
  luminance += visibleLuma(centerUv + vec2(sampleOffset.x, -sampleOffset.y)) * 0.15;
  luminance += visibleLuma(centerUv - sampleOffset) * 0.15;

  float safeSpan = max(0.01, u_span);
  float proxy = (luminance - (u_level - safeSpan * 0.5)) / safeSpan;
  proxy = (proxy - 0.5) * u_contrast + 0.5;
  float fixedNoise = (hash21(cell, 9.17) - 0.5) * u_fixedPatternNoise;
  float temporalNoise = (hash21(cell, u_frameSeed) - 0.5) * u_noise;
  proxy = clamp(proxy + fixedNoise + temporalNoise, 0.0, 1.0);
  vec3 result = sampleGradient(proxy);

  if (u_crosshair == 1) {
    vec2 center = floor(u_res * 0.5);
    vec2 delta = abs(pixel - center);
    float armLength = floor(min(u_res.x, u_res.y) * 0.04);
    float gap = max(2.0, floor(armLength * 0.4));
    bool horizontal = delta.y < 0.5 && delta.x >= gap && delta.x <= gap + armLength;
    bool vertical = delta.x < 0.5 && delta.y >= gap && delta.y <= gap + armLength;
    if (horizontal || vertical) result = u_hotColor;
  }

  float sourceAlpha = texture(u_source, v_uv).a;
  fragColor = vec4(clamp(result, 0.0, 1.0), sourceAlpha);
}
`;

type Cache = { thermal: Program };
let cache: Cache | null = null;

const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (!cache) {
    cache = {
      thermal: linkProgram(gl, THERMAL_PROXY_FS, [
        "u_source", "u_res", "u_level", "u_span", "u_contrast", "u_sensorWidth",
        "u_noise", "u_fixedPatternNoise", "u_frameSeed", "u_stopCount", "u_stops[0]",
        "u_crosshair", "u_hotColor",
      ] as const),
    };
  }
  return cache.thermal;
};

const sampleStops = (stops: number[][], value: number): [number, number, number] => {
  const position = Math.min(1, Math.max(0, value)) * (stops.length - 1);
  const index = Math.min(stops.length - 1, Math.floor(position));
  const next = Math.min(stops.length - 1, index + 1);
  const fraction = position - index;
  return [0, 1, 2].map((channel) => (
    stops[index][channel] + (stops[next][channel] - stops[index][channel]) * fraction
  )) as [number, number, number];
};

type ThermalOptions = Partial<typeof defaults> & { _frameIndex?: number };

const thermalCamera = (input: any, options: ThermalOptions = defaults) => {
  const resolved = { ...defaults, ...options };
  const {
    colormap, level, span, contrast, sensorWidth, noiseAmount,
    fixedPatternNoise, crosshair, palette,
  } = resolved;
  const width = input.width;
  const height = input.height;
  const context = getGLCtx();
  if (!context) return input;
  const { gl, canvas } = context;
  const program = getProgram(gl);
  const vao = getQuadVAO(gl);
  const stops = colormaps[colormap] ?? colormaps[COLORMAP_IRONBOW];
  const stopCount = Math.min(MAX_STOPS, stops.length);
  const flatStops = new Float32Array(MAX_STOPS * 3);
  for (let index = 0; index < stopCount; index += 1) {
    flatStops[index * 3] = stops[index][0] / 255;
    flatStops[index * 3 + 1] = stops[index][1] / 255;
    flatStops[index * 3 + 2] = stops[index][2] / 255;
  }
  const hotColor = sampleStops(stops, 0.85);

  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "thermalCamera:source", width, height);
  uploadSourceTexture(gl, sourceTexture, input);
  drawPass(gl, null, width, height, program, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(program.uniforms.u_source, 0);
    gl.uniform2f(program.uniforms.u_res, width, height);
    gl.uniform1f(program.uniforms.u_level, level);
    gl.uniform1f(program.uniforms.u_span, span);
    gl.uniform1f(program.uniforms.u_contrast, contrast);
    gl.uniform1f(program.uniforms.u_sensorWidth, sensorWidth);
    gl.uniform1f(program.uniforms.u_noise, noiseAmount);
    gl.uniform1f(program.uniforms.u_fixedPatternNoise, fixedPatternNoise);
    gl.uniform1f(program.uniforms.u_frameSeed, (options._frameIndex ?? 0) * 7919 + 31337);
    gl.uniform1i(program.uniforms.u_stopCount, stopCount);
    gl.uniform3fv(program.uniforms["u_stops[0]"], flatStops);
    gl.uniform1i(program.uniforms.u_crosshair, crosshair ? 1 : 0);
    gl.uniform3f(program.uniforms.u_hotColor, hotColor[0] / 255, hotColor[1] / 255, hotColor[2] / 255);
  }, vao);

  const rendered = readoutToCanvas(canvas, width, height);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend("Thermal camera", "WebGL2", `visible-proxy ${sensorWidth}px ${colormap}${identity ? "" : "+palettePass"}`);
  return output ?? input;
};

export default defineFilter({
  name: "Thermal camera",
  func: thermalCamera,
  options: defaults,
  optionTypes,
  defaults,
  description: "Visible-RGB luminance proxy—not emitted-IR temperature—through a low-resolution thermal-camera display",
  requiresGL: true,
});
