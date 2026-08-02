import { COLOR, RANGE } from "../constants/controlTypes";
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
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";

export const optionTypes = {
  spread: {
    type: RANGE,
    range: [0, 12],
    step: 1,
    default: 4,
    desc: "Maximum capillary reach of dark ink along the paper fibers",
  },
  absorbency: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.55,
    desc: "How strongly neighboring ink transfers through the porous sheet",
  },
  paperTint: { type: COLOR, default: [242, 235, 217], desc: "Base color of the unprinted paper" },
  inkColor: {
    type: COLOR,
    default: [24, 18, 14],
    desc: "Color of the deposited ink after liquid absorption",
  },
  grain: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.22,
    desc: "Fine and broad paper-fiber texture in the unprinted substrate",
  },
  fiberAngle: {
    type: RANGE,
    range: [0, 180],
    step: 1,
    default: 8,
    desc: "Dominant in-plane paper-fiber direction in degrees",
  },
  anisotropy: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.65,
    desc: "Difference between capillary reach along and across the fibers",
  },
  feather: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.35,
    desc: "Softness and partial saturation at the outer wet-ink boundary",
  },
};

export const defaults = {
  spread: optionTypes.spread.default,
  absorbency: optionTypes.absorbency.default,
  paperTint: optionTypes.paperTint.default,
  inkColor: optionTypes.inkColor.default,
  grain: optionTypes.grain.default,
  fiberAngle: optionTypes.fiberAngle.default,
  anisotropy: optionTypes.anisotropy.default,
  feather: optionTypes.feather.default,
};

const INK_BLEED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_spread;
uniform float u_absorbency;
uniform vec3 u_paperTint;
uniform vec3 u_inkColor;
uniform float u_grain;
uniform float u_fiberAngle;
uniform float u_anisotropy;
uniform float u_feather;

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

float inkAt(vec2 pixel) {
  vec3 color = texture(u_source, clamp((pixel + 0.5) / u_res, vec2(0.0), vec2(1.0))).rgb;
  return 1.0 - dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 pixel = floor(v_uv * u_res);
  vec4 source = texture(u_source, (pixel + 0.5) / u_res);
  float coverage = 1.0 - dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));

  float sheetVariation = valueNoise(pixel / 22.0);
  float angle = radians(u_fiberAngle) + (sheetVariation - 0.5) * 1.15 * u_anisotropy;
  vec2 along = vec2(cos(angle), sin(angle));
  vec2 across = vec2(-along.y, along.x);
  float alongReach = mix(0.8, 1.35, u_anisotropy);
  float acrossReach = mix(0.8, 0.42, u_anisotropy);
  float spreadScale = max(1.0, float(u_spread) + 1.0);

  for (int stepIndex = 1; stepIndex <= 12; stepIndex++) {
    if (stepIndex > u_spread) break;
    float stepDistance = float(stepIndex);
    float falloff = max(0.0, 1.0 - stepDistance / spreadScale);
    float poreReach = mix(0.62, 1.18, valueNoise(pixel * 0.11 + float(stepIndex) * 5.7));
    float transfer = u_absorbency * falloff * poreReach;

    vec2 alongOffset = along * stepDistance * alongReach;
    vec2 acrossOffset = across * stepDistance * acrossReach;
    coverage = max(coverage, inkAt(pixel + alongOffset) * transfer);
    coverage = max(coverage, inkAt(pixel - alongOffset) * transfer);
    coverage = max(coverage, inkAt(pixel + acrossOffset) * transfer * 0.82);
    coverage = max(coverage, inkAt(pixel - acrossOffset) * transfer * 0.82);

    vec2 branch = normalize(along + across * (valueNoise(pixel / 9.0 + stepDistance) - 0.5));
    coverage = max(coverage, inkAt(pixel + branch * stepDistance) * transfer * 0.72);
    coverage = max(coverage, inkAt(pixel - branch * stepDistance) * transfer * 0.72);
  }

  coverage = clamp(mix(smoothstep(0.03, 0.94, coverage), coverage, u_feather), 0.0, 1.0);
  // Fiber orientation is axial: 0° and 180° describe the same sheet. Anchor
  // the texture at the image centre and discard coordinate sign so reversing
  // the axis does not select a different paper realization.
  vec2 centredPixel = pixel - u_res * 0.5;
  float longFiber = sin(abs(dot(centredPixel, across)) * 0.19 + valueNoise(pixel / 31.0) * 6.28318);
  float fiberTexture = longFiber * 0.5 + 0.5;
  float fineTexture = hash21(pixel);
  float paperVariation = ((fiberTexture - 0.5) * 0.045 + (fineTexture - 0.5) * 0.035) * u_grain;
  vec3 paper = clamp(u_paperTint * (1.0 + paperVariation), 0.0, 1.0);

  float inkGranulation = mix(0.88, 1.08, valueNoise(pixel * 0.23 + 19.0));
  vec3 depositedInk = clamp(u_inkColor * inkGranulation, 0.0, 1.0);
  vec3 result = mix(paper, depositedInk, coverage);
  fragColor = vec4(result, source.a);
}
`;

type Cache = { ink: Program };
let cache: Cache | null = null;

const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (!cache) {
    cache = {
      ink: linkProgram(gl, INK_BLEED_FS, [
        "u_source",
        "u_res",
        "u_spread",
        "u_absorbency",
        "u_paperTint",
        "u_inkColor",
        "u_grain",
        "u_fiberAngle",
        "u_anisotropy",
        "u_feather",
      ] as const),
    };
  }
  return cache.ink;
};

const inkBleed = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const { spread, absorbency, paperTint, inkColor, grain, fiberAngle, anisotropy, feather } =
    resolved;
  const width = input.width;
  const height = input.height;
  const context = getGLCtx();
  if (!context) return input;
  const { gl, canvas } = context;
  const program = getProgram(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "inkBleed:source", width, height);
  uploadSourceTexture(gl, sourceTexture, input);
  drawPass(
    gl,
    null,
    width,
    height,
    program,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
      gl.uniform1i(program.uniforms.u_source, 0);
      gl.uniform2f(program.uniforms.u_res, width, height);
      gl.uniform1i(program.uniforms.u_spread, Math.max(0, Math.min(12, Math.round(spread))));
      gl.uniform1f(program.uniforms.u_absorbency, absorbency);
      gl.uniform3f(
        program.uniforms.u_paperTint,
        paperTint[0] / 255,
        paperTint[1] / 255,
        paperTint[2] / 255,
      );
      gl.uniform3f(
        program.uniforms.u_inkColor,
        inkColor[0] / 255,
        inkColor[1] / 255,
        inkColor[2] / 255,
      );
      gl.uniform1f(program.uniforms.u_grain, grain);
      gl.uniform1f(program.uniforms.u_fiberAngle, fiberAngle);
      gl.uniform1f(program.uniforms.u_anisotropy, anisotropy);
      gl.uniform1f(program.uniforms.u_feather, feather);
    },
    vao,
  );

  const output = readoutToCanvas(canvas, width, height);
  logFilterBackend("Ink Bleed", "WebGL2", `spread=${spread} absorbency=${absorbency}`);
  return output ?? input;
};

export default defineFilter({
  name: "Ink Bleed",
  func: inkBleed,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Dark ink wicks through an anisotropic paper-fiber field with heterogeneous capillary edges",
  requiresGL: true,
});
