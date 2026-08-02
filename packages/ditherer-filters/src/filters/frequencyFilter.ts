import { RANGE, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  applyPalettePassToCanvas,
  paletteIsIdentity,
  PALETTE_NEAREST_GLSL,
} from "../palettes/backend";
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
import { sigmaForRadius } from "./opticalConvolutionContracts";
import { normalizeEnumOption, normalizeRangeOption } from "../utils/filterOptions";

const MODE = {
  LOW: "LOW",
  HIGH: "HIGH",
  BAND: "BAND",
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Low-pass", value: MODE.LOW },
      { name: "High-pass", value: MODE.HIGH },
      { name: "Band-pass", value: MODE.BAND },
    ],
    default: MODE.HIGH,
    desc: "Which frequency band to keep",
  },
  radius: {
    type: RANGE,
    range: [1, 24],
    step: 1,
    default: 6,
    desc: "Approximate cutoff radius for the low-frequency blur",
  },
  bandWidth: {
    type: RANGE,
    range: [1, 24],
    step: 1,
    default: 6,
    desc: "Additional blur width used for the outer edge of band-pass mode",
  },
  gain: {
    type: RANGE,
    range: [0, 4],
    step: 0.05,
    default: 1.5,
    desc: "Boost the kept band before remapping back into the image",
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  mode: optionTypes.mode.default,
  radius: optionTypes.radius.default,
  bandWidth: optionTypes.bandWidth.default,
  gain: optionTypes.gain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type FrequencyFilterPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type FrequencyFilterOptions = FilterOptionValues & {
  mode?: string;
  radius?: number;
  bandWidth?: number;
  gain?: number;
  palette?: FrequencyFilterPalette;
  _wasmAcceleration?: boolean;
};

// Separable GAUSSIAN blur: one horizontal pass, one vertical pass. A box blur's
// frequency response is a sinc with large, sign-inverting side-lobes, so a
// "low-pass" built from a box actually passes and phase-inverts alternating
// high-frequency bands (ringing). A Gaussian rolls off monotonically with no
// side-lobes, so LOW/HIGH/BAND isolate frequency bands honestly. Weights are
// exp(-k²/2σ²) normalised by the tap sum (σ = radius/3, sigmaForRadius). Loop
// bounds are dynamic in #version 300 es so we can read u_radius directly.
const HORIZ_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_texel;
uniform int   u_radius;
uniform float u_sigma;

void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float inv2s2 = 1.0 / (2.0 * u_sigma * u_sigma);
  for (int k = -u_radius; k <= u_radius; k++) {
    float w = exp(-float(k * k) * inv2s2);
    acc += w * texture(u_source, v_uv + vec2(float(k), 0.0) * u_texel);
    wsum += w;
  }
  fragColor = acc / wsum;
}
`;

const VERT_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_texel;
uniform int   u_radius;
uniform float u_sigma;

void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float inv2s2 = 1.0 / (2.0 * u_sigma * u_sigma);
  for (int k = -u_radius; k <= u_radius; k++) {
    float w = exp(-float(k * k) * inv2s2);
    acc += w * texture(u_source, v_uv + vec2(0.0, float(k)) * u_texel);
    wsum += w;
  }
  fragColor = acc / wsum;
}
`;

const COMBINE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_lowA;
uniform sampler2D u_lowB;
uniform float u_gain;
uniform int   u_mode;          // 0 LOW, 1 HIGH, 2 BAND
uniform int   u_paletteLevels;

${PALETTE_NEAREST_GLSL}

void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 a = texture(u_lowA, v_uv).rgb;
  vec3 rgb;
  if (u_mode == 0) {
    rgb = a * 255.0;
  } else if (u_mode == 1) {
    rgb = clamp(128.0 + (src.rgb - a) * 255.0 * u_gain, 0.0, 255.0);
  } else {
    vec3 b = texture(u_lowB, v_uv).rgb;
    rgb = clamp(128.0 + (a - b) * 255.0 * u_gain, 0.0, 255.0);
  }
  if (u_paletteLevels >= 2 && u_paletteLevels < 256) {
    rgb = applyNearestLevelsRGB(rgb, u_paletteLevels);
  }
  fragColor = vec4(rgb / 255.0, src.a);
}
`;

let _horiz: Program | null = null;
let _vert: Program | null = null;
let _combine: Program | null = null;

const getHorizProg = (gl: WebGL2RenderingContext): Program => {
  if (_horiz) return _horiz;
  _horiz = linkProgram(gl, HORIZ_BLUR_FS, ["u_source", "u_texel", "u_radius", "u_sigma"] as const);
  return _horiz;
};

const getVertProg = (gl: WebGL2RenderingContext): Program => {
  if (_vert) return _vert;
  _vert = linkProgram(gl, VERT_BLUR_FS, ["u_source", "u_texel", "u_radius", "u_sigma"] as const);
  return _vert;
};

const getCombineProg = (gl: WebGL2RenderingContext): Program => {
  if (_combine) return _combine;
  _combine = linkProgram(gl, COMBINE_FS, [
    "u_source",
    "u_lowA",
    "u_lowB",
    "u_gain",
    "u_mode",
    "u_paletteLevels",
  ] as const);
  return _combine;
};

const modeId = (m: string) => (m === MODE.LOW ? 0 : m === MODE.BAND ? 2 : 1);

const blurInto = (
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  W: number,
  H: number,
  sourceTex: WebGLTexture,
  tempName: string,
  lowName: string,
  radius: number,
) => {
  const sigma = sigmaForRadius(radius);
  const horizProg = getHorizProg(gl);
  const vertProg = getVertProg(gl);
  const temp = ensureTexture(gl, tempName, W, H);
  const low = ensureTexture(gl, lowName, W, H);
  drawPass(
    gl,
    temp,
    W,
    H,
    horizProg,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      gl.uniform1i(horizProg.uniforms.u_source, 0);
      gl.uniform2f(horizProg.uniforms.u_texel, 1 / W, 1 / H);
      gl.uniform1i(horizProg.uniforms.u_radius, radius);
      gl.uniform1f(horizProg.uniforms.u_sigma, sigma);
    },
    vao,
  );
  drawPass(
    gl,
    low,
    W,
    H,
    vertProg,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, temp.tex);
      gl.uniform1i(vertProg.uniforms.u_source, 0);
      gl.uniform2f(vertProg.uniforms.u_texel, 1 / W, 1 / H);
      gl.uniform1i(vertProg.uniforms.u_radius, radius);
      gl.uniform1f(vertProg.uniforms.u_sigma, sigma);
    },
    vao,
  );
  return low;
};

const frequencyFilter = (input: any, options: FrequencyFilterOptions = defaults) => {
  const mode = normalizeEnumOption(options.mode, [MODE.LOW, MODE.HIGH, MODE.BAND], defaults.mode);
  const radius = normalizeRangeOption(options.radius, defaults.radius, 1, 24, true);
  const bandWidth = normalizeRangeOption(options.bandWidth, defaults.bandWidth, 1, 24, true);
  const gain = normalizeRangeOption(options.gain, defaults.gain, 0, 4, false);
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "frequencyFilter:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const lowA = blurInto(
    gl,
    vao,
    W,
    H,
    sourceTex.tex,
    "frequencyFilter:tempA",
    "frequencyFilter:lowA",
    radius,
  );
  const lowB =
    mode === MODE.BAND
      ? blurInto(
          gl,
          vao,
          W,
          H,
          sourceTex.tex,
          "frequencyFilter:tempB",
          "frequencyFilter:lowB",
          radius + bandWidth,
        )
      : lowA;

  const pOpts = (palette as { options?: { levels?: number } }).options;
  const isNearestPalette =
    palette === defaults.palette || (palette as { name?: string }).name === "nearest";
  const shaderLevels = isNearestPalette ? (pOpts?.levels ?? 256) : 256;

  const combineProg = getCombineProg(gl);
  drawPass(
    gl,
    null,
    W,
    H,
    combineProg,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(combineProg.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lowA.tex);
      gl.uniform1i(combineProg.uniforms.u_lowA, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, lowB.tex);
      gl.uniform1i(combineProg.uniforms.u_lowB, 2);
      gl.uniform1f(combineProg.uniforms.u_gain, gain);
      gl.uniform1i(combineProg.uniforms.u_mode, modeId(mode));
      gl.uniform1i(
        combineProg.uniforms.u_paletteLevels,
        Math.max(1, Math.min(256, Math.round(shaderLevels))),
      );
    },
    vao,
  );

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return glUnavailableStub(W, H);

  const skipPostPass = isNearestPalette || paletteIsIdentity(palette);
  const out = skipPostPass
    ? rendered
    : applyPalettePassToCanvas(rendered, W, H, palette, options._wasmAcceleration !== false) ||
      rendered;
  logFilterBackend(
    "Frequency Filter",
    "WebGL2",
    `mode=${mode} r=${radius}${skipPostPass ? "" : "+palettePass"}`,
  );
  return out;
};

export default defineFilter({
  name: "Frequency Filter",
  func: frequencyFilter,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Low, high, or mid-band frequency separation via Gaussian (and difference-of-Gaussian) spatial-domain filtering",
  requiresGL: true,
});
