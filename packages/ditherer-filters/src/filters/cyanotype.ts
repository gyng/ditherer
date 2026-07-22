import { BOOL, COLOR, PALETTE, RANGE } from "../constants/controlTypes";
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
import { cyanotypeGrainAmplitude } from "./physicalImagingQualityContracts";
import { defineFilter } from "./types";

export const optionTypes = {
  highlightColor: { type: COLOR, default: [236, 242, 250], desc: "Color of washed, unexposed paper highlights" },
  shadowColor: { type: COLOR, default: [21, 43, 96], desc: "Prussian-blue color at maximum image density" },
  exposure: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Print exposure bias before blue-density formation" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.4, desc: "Separation between washed paper and dense blue image areas" },
  grain: { type: RANGE, range: [0, 0.4], step: 0.005, default: 0.06, desc: "Bounded Prussian-blue granulation in normalized tone units" },
  paperTint: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Warmth of the washed paper base" },
  wash: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Clearing of unexposed sensitizer from paper highlights" },
  blueDensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.9, desc: "Maximum retained Prussian-blue image density" },
  fiberTexture: { type: RANGE, range: [0, 1], step: 0.02, default: 0.18, desc: "Directional paper-fiber and coating variation" },
  invert: { type: BOOL, default: false, desc: "Reverse positive-image mapping to emulate contact-negative exposure" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  highlightColor: optionTypes.highlightColor.default,
  shadowColor: optionTypes.shadowColor.default,
  exposure: optionTypes.exposure.default,
  contrast: optionTypes.contrast.default,
  grain: optionTypes.grain.default,
  paperTint: optionTypes.paperTint.default,
  wash: optionTypes.wash.default,
  blueDensity: optionTypes.blueDensity.default,
  fiberTexture: optionTypes.fiberTexture.default,
  invert: optionTypes.invert.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const CYANOTYPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform vec3 u_highlight;
uniform vec3 u_shadow;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_grain;
uniform float u_paperTint;
uniform float u_wash;
uniform float u_blueDensity;
uniform float u_fiberTexture;
uniform int u_invert;

float hash21(vec2 point) {
  vec3 p = fract(vec3(point.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

vec3 srgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

void main() {
  vec2 pixel = floor(v_uv * u_res);
  vec4 source = texture(u_source, (pixel + 0.5) / u_res);
  vec3 linearSource = srgbToLinear(source.rgb);
  float luminance = dot(linearSource, vec3(0.2126, 0.7152, 0.0722));

  float shifted = clamp(luminance + u_exposure * 0.35, 0.0, 1.0);
  float paperSignal = clamp((shifted - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float density = u_invert == 1 ? paperSignal : 1.0 - paperSignal;
  density *= u_blueDensity;

  float washedDensity = smoothstep(0.07, 0.78, density);
  density = mix(density, washedDensity, u_wash * 0.72);
  float densityMask = 4.0 * density * (1.0 - density);
  float granulation = (hash21(pixel + 19.0) - 0.5) * u_grain * densityMask;
  density = clamp(density + granulation, 0.0, 1.0);

  float longFiber = sin(pixel.x * 0.12 + valueNoise(pixel / 29.0) * 5.5) * 0.5 + 0.5;
  float crossFiber = sin(pixel.y * 0.21 + valueNoise(pixel.yx / 17.0) * 4.2) * 0.5 + 0.5;
  float fiber = (longFiber * 0.65 + crossFiber * 0.35) - 0.5;
  density = clamp(density + fiber * u_fiberTexture * 0.075 * densityMask, 0.0, 1.0);

  vec3 warmPaper = vec3(0.973, 0.953, 0.902);
  vec3 paper = mix(u_highlight, warmPaper, u_paperTint);
  paper *= 1.0 + fiber * u_fiberTexture * 0.04;
  vec3 blue = u_shadow * mix(0.88, 1.08, valueNoise(pixel * 0.18 + 7.0));
  vec3 result = mix(paper, blue, density);
  fragColor = vec4(clamp(result, 0.0, 1.0), source.a);
}
`;

type Cache = { cyanotype: Program };
let cache: Cache | null = null;

const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (!cache) {
    cache = {
      cyanotype: linkProgram(gl, CYANOTYPE_FS, [
        "u_source", "u_res", "u_highlight", "u_shadow", "u_exposure", "u_contrast",
        "u_grain", "u_paperTint", "u_wash", "u_blueDensity", "u_fiberTexture", "u_invert",
      ] as const),
    };
  }
  return cache.cyanotype;
};

const cyanotype = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const {
    highlightColor, shadowColor, exposure, contrast, grain, paperTint,
    wash, blueDensity, fiberTexture, invert, palette,
  } = resolved;
  const width = input.width;
  const height = input.height;
  const context = getGLCtx();
  if (!context) return input;
  const { gl, canvas } = context;
  const program = getProgram(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "cyanotype:source", width, height);
  uploadSourceTexture(gl, sourceTexture, input);
  drawPass(gl, null, width, height, program, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(program.uniforms.u_source, 0);
    gl.uniform2f(program.uniforms.u_res, width, height);
    gl.uniform3f(program.uniforms.u_highlight, highlightColor[0] / 255, highlightColor[1] / 255, highlightColor[2] / 255);
    gl.uniform3f(program.uniforms.u_shadow, shadowColor[0] / 255, shadowColor[1] / 255, shadowColor[2] / 255);
    gl.uniform1f(program.uniforms.u_exposure, exposure);
    gl.uniform1f(program.uniforms.u_contrast, contrast);
    gl.uniform1f(program.uniforms.u_grain, cyanotypeGrainAmplitude(grain));
    gl.uniform1f(program.uniforms.u_paperTint, paperTint);
    gl.uniform1f(program.uniforms.u_wash, wash);
    gl.uniform1f(program.uniforms.u_blueDensity, blueDensity);
    gl.uniform1f(program.uniforms.u_fiberTexture, fiberTexture);
    gl.uniform1i(program.uniforms.u_invert, invert ? 1 : 0);
  }, vao);

  const rendered = readoutToCanvas(canvas, width, height);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend("Cyanotype", "WebGL2", `density=${blueDensity} wash=${wash}${identity ? "" : "+palettePass"}`);
  return output ?? input;
};

export default defineFilter({
  name: "Cyanotype",
  func: cyanotype,
  optionTypes,
  options: defaults,
  defaults,
  description: "Washed cyanotype paper with bounded Prussian-blue image density, granulation, and directional fibers",
  requiresGL: true,
});
