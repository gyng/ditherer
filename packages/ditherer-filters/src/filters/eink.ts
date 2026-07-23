import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { nearest } from "../palettes/index";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { einkReflectanceLevel, kaleidoChannelLevel, kaleidoColorCell } from "./consumerImagingQualityContracts";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

const EINK_GRAYSCALE = "GRAYSCALE";
const EINK_COLOR = "COLOR";
const REFRESH_FULL = "FULL";
const REFRESH_PARTIAL = "PARTIAL";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Carta (16-gray)", value: EINK_GRAYSCALE },
      { name: "Kaleido CFA (4096-color proxy)", value: EINK_COLOR },
    ],
    default: EINK_GRAYSCALE,
    desc: "Reflective monochrome ink or a printed color-filter-array proxy with 16 levels per color channel",
  },
  refreshMode: {
    type: ENUM,
    options: [
      { name: "Full GC16 clear", value: REFRESH_FULL },
      { name: "Partial / direct", value: REFRESH_PARTIAL },
    ],
    default: REFRESH_PARTIAL,
    desc: "Full updates flash through clearing drives; partial updates retain a changed-pixel residual",
  },
  fullRefreshEvery: {
    type: RANGE,
    range: [6, 240],
    step: 1,
    default: 72,
    desc: "With video input, begin a full clearing waveform every N frames",
  },
  contrast: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1.2, desc: "Contrast applied before the display's 16-state quantizer" },
  paperWhite: { type: RANGE, range: [180, 255], step: 1, default: 230, desc: "Brightest achievable reflective-paper value" },
  inkBlack: { type: RANGE, range: [0, 80], step: 1, default: 15, desc: "Darkest achievable charged-pigment value" },
  colorSaturation: { type: RANGE, range: [0, 1], step: 0.01, default: 0.55, desc: "Kaleido color-filter saturation; monochrome mode ignores it" },
  ghosting: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Transition-dependent changed-pixel residual in partial refresh mode" },
  pixelGrid: { type: BOOL, default: false, desc: "Reveal the three-monochrome-pixel Kaleido color-cell boundaries" },
  texture: { type: RANGE, range: [0, 0.3], step: 0.01, default: 0.06, desc: "Frame-invariant paper reflectance grain" },
  pageRefresh: {
    type: ACTION,
    label: "Page refresh",
    desc: "Run a short full clearing waveform",
    action: (actions: any, inputCanvas: any) => {
      actions.triggerBurst(inputCanvas, 10, 4);
    },
  },
  refreshRate: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Animated update cadence in frames per second" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop the update-waveform preview",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.refreshRate || 2);
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional palette mapping applied after the display and refresh simulation" },
};

export const defaults = {
  mode: optionTypes.mode.default,
  refreshMode: optionTypes.refreshMode.default,
  fullRefreshEvery: optionTypes.fullRefreshEvery.default,
  contrast: optionTypes.contrast.default,
  paperWhite: optionTypes.paperWhite.default,
  inkBlack: optionTypes.inkBlack.default,
  colorSaturation: optionTypes.colorSaturation.default,
  ghosting: optionTypes.ghosting.default,
  pixelGrid: optionTypes.pixelGrid.default,
  texture: optionTypes.texture.default,
  refreshRate: optionTypes.refreshRate.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type EinkPalette = { options?: FilterOptionValues } & Record<string, unknown>;
type EinkOptions = FilterOptionValues & {
  mode?: string;
  refreshMode?: string;
  fullRefreshEvery?: number;
  contrast?: number;
  paperWhite?: number;
  inkBlack?: number;
  colorSaturation?: number;
  ghosting?: number;
  pixelGrid?: boolean;
  texture?: number;
  refreshRate?: number;
  palette?: EinkPalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
  _isAnimating?: boolean;
  _hasVideoInput?: boolean;
  _webglAcceleration?: boolean;
};

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);

const paperNoise = (x: number, y: number): number => {
  let hash = (Math.imul(x >>> 0, 374761393) + Math.imul(y >>> 0, 668265263) + 2246822519) >>> 0;
  hash = Math.imul((hash ^ (hash >>> 13)) >>> 0, 1274126177) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return (hash & 0x00ffffff) / 16777215;
};

const opticalTarget = (
  source: Uint8ClampedArray,
  index: number,
  isColor: boolean,
  contrast: number,
  black: number,
  white: number,
  saturation: number,
  grain: number,
): [number, number, number] => {
  const red = source[index] / 255;
  const green = source[index + 1] / 255;
  const blue = source[index + 2] / 255;
  const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const contrasted = clamp01(0.5 + (luma - 0.5) * contrast + grain);
  if (!isColor) {
    const level = einkReflectanceLevel(contrasted, black, white) * 255;
    return [level, level, level];
  }

  const span = Math.max(1 / 255, white - black);
  const base = black + contrasted * span;
  const quantize = (channel: number): number => {
    const optical = clamp01((base + (channel - luma) * saturation * span - black) / span);
    return (black + kaleidoChannelLevel(optical) * span) * 255;
  };
  return [quantize(red), quantize(green), quantize(blue)];
};

const partialResidual = (target: number, previous: number, ghosting: number): number => {
  const change = Math.abs(target - previous) / 255;
  const transition = clamp01((change - 0.01) / 0.24);
  const direction = target > previous ? 1.15 : 0.85;
  const keep = clamp01(ghosting * transition * direction);
  return target * (1 - keep) + previous * keep;
};

const EINK_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform int u_hasPrev;
uniform int u_isColor;
uniform float u_contrast;
uniform float u_inkBlack;
uniform float u_paperWhite;
uniform float u_colorSaturation;
uniform float u_texture;
uniform int u_pixelGrid;
uniform int u_phase;
uniform int u_isFullRefresh;
uniform int u_isAnimLoop;
uniform float u_ghosting;
uniform int u_refreshIsPartial;

float paperNoise(float x, float y) {
  uint hash = uint(x) * 374761393u + uint(y) * 668265263u + 2246822519u;
  hash = (hash ^ (hash >> 13u)) * 1274126177u;
  hash ^= hash >> 16u;
  return float(hash & 0x00ffffffu) / 16777215.0;
}

float quantize16(float value) {
  return floor(clamp(value, 0.0, 1.0) * 15.0 + 0.5) / 15.0;
}

vec3 opticalTarget(vec3 source, float grain) {
  float luma = dot(source, vec3(0.2126, 0.7152, 0.0722));
  float contrasted = clamp(0.5 + (luma - 0.5) * u_contrast + grain, 0.0, 1.0);
  float span = max(1.0 / 255.0, u_paperWhite - u_inkBlack);
  if (u_isColor == 0) {
    return vec3(u_inkBlack + quantize16(contrasted) * span);
  }
  float base = u_inkBlack + contrasted * span;
  vec3 optical = clamp((base + (source - vec3(luma)) * u_colorSaturation * span - u_inkBlack) / span, 0.0, 1.0);
  return vec3(u_inkBlack) + vec3(quantize16(optical.r), quantize16(optical.g), quantize16(optical.b)) * span;
}

float residual(float target, float previous) {
  float change = abs(target - previous);
  float transition = clamp((change - 0.01) / 0.24, 0.0, 1.0);
  float direction = target > previous ? 1.15 : 0.85;
  float keep = clamp(u_ghosting * transition * direction, 0.0, 1.0);
  return mix(target, previous, keep);
}

void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec2 pixelUv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 sourcePixel = texture(u_source, pixelUv);

  if (u_isFullRefresh == 1 && u_isAnimLoop == 1 && u_phase < 2) {
    float drive = u_phase == 0 ? u_paperWhite : u_inkBlack;
    fragColor = vec4(vec3(drive), sourcePixel.a);
    return;
  }

  float sampleX = u_isColor == 1 ? min(floor(x / 3.0) * 3.0 + 1.0, u_res.x - 1.0) : x;
  float sampleY = u_isColor == 1 ? min(floor(y / 3.0) * 3.0 + 1.0, u_res.y - 1.0) : y;
  vec2 sampleUv = vec2((sampleX + 0.5) / u_res.x, 1.0 - (sampleY + 0.5) / u_res.y);
  vec3 sampled = texture(u_source, sampleUv).rgb;
  float grain = (paperNoise(x, y) - 0.5) * u_texture;
  vec3 target = opticalTarget(sampled, grain);

  if (u_isColor == 1 && u_pixelGrid == 1 && (mod(x, 3.0) < 0.5 || mod(y, 3.0) < 0.5)) {
    target *= 0.92;
  }

  if (u_refreshIsPartial == 1 && u_hasPrev == 1 && u_ghosting > 0.0) {
    vec3 previous = texture(u_prev, pixelUv).rgb;
    if (u_isColor == 0) previous = vec3(dot(previous, vec3(0.2126, 0.7152, 0.0722)));
    target = vec3(residual(target.r, previous.r), residual(target.g, previous.g), residual(target.b, previous.b));
  }
  fragColor = vec4(clamp(target, 0.0, 1.0), sourcePixel.a);
}
`;

type Cache = { eink: Program; prevTex: WebGLTexture | null; prevBuf: Uint8ClampedArray | null; w: number; h: number };
let cacheValue: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (cacheValue) return cacheValue;
  cacheValue = {
    eink: linkProgram(gl, EINK_FS, [
      "u_source", "u_prev", "u_res", "u_hasPrev", "u_isColor", "u_contrast",
      "u_inkBlack", "u_paperWhite", "u_colorSaturation", "u_texture", "u_pixelGrid",
      "u_phase", "u_isFullRefresh", "u_isAnimLoop", "u_ghosting", "u_refreshIsPartial",
    ] as const),
    prevTex: null,
    prevBuf: null,
    w: 0,
    h: 0,
  };
  return cacheValue;
};

const ensurePrevTex = (gl: WebGL2RenderingContext, cache: Cache, width: number, height: number) => {
  if (cache.prevTex && cache.w === width && cache.h === height) return cache.prevTex;
  if (cache.prevTex) gl.deleteTexture(cache.prevTex);
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.prevTex = texture;
  cache.prevBuf = null;
  cache.w = width;
  cache.h = height;
  return texture;
};

const eink = (input: HTMLCanvasElement, options: EinkOptions = defaults) => {
  const mode = options.mode === EINK_COLOR ? EINK_COLOR : EINK_GRAYSCALE;
  const refreshMode = options.refreshMode === REFRESH_FULL ? REFRESH_FULL : REFRESH_PARTIAL;
  const contrast = clamp(finite(options.contrast, defaults.contrast), 0.5, 2);
  const rawBlack = clamp(finite(options.inkBlack, defaults.inkBlack), 0, 80) / 255;
  const rawWhite = clamp(finite(options.paperWhite, defaults.paperWhite), 180, 255) / 255;
  const inkBlack = Math.min(rawBlack, rawWhite - 1 / 255);
  const paperWhite = Math.max(rawWhite, inkBlack + 1 / 255);
  const colorSaturation = clamp01(finite(options.colorSaturation, defaults.colorSaturation));
  const ghosting = clamp01(finite(options.ghosting, defaults.ghosting));
  const texture = clamp(finite(options.texture, defaults.texture), 0, 0.3);
  const fullRefreshEvery = clamp(Math.round(finite(options.fullRefreshEvery, defaults.fullRefreshEvery)), 6, 240);
  const pixelGrid = options.pixelGrid === true;
  const palette = options.palette ?? defaults.palette;
  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Math.max(0, Math.floor(finite(options._frameIndex, 0)));
  const isAnimLoop = Boolean(options._isAnimating);
  const hasVideoInput = Boolean(options._hasVideoInput);
  const width = input.width;
  const height = input.height;
  const isColor = mode === EINK_COLOR;
  const isFullRefresh = refreshMode === REFRESH_FULL;
  let phase = 2;
  if (isAnimLoop && isFullRefresh) {
    phase = hasVideoInput ? ((frameIndex % fullRefreshEvery) < 2 ? frameIndex % fullRefreshEvery : 2) : frameIndex % 4;
  }

  if (glAvailable() && options._webglAcceleration !== false) {
    const context = getGLCtx();
    if (context) {
      const { gl, canvas } = context;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, width, height);
      const sourceTex = ensureTexture(gl, "eink:source", width, height);
      uploadSourceTexture(gl, sourceTex, input);
      const prevTex = ensurePrevTex(gl, cache, width, height);
      const hasPrev = Boolean(prevOutput && prevOutput.length === width * height * 4 && prevTex);
      if (hasPrev && prevTex && prevOutput) {
        if (!cache.prevBuf || cache.prevBuf.length !== prevOutput.length) cache.prevBuf = new Uint8ClampedArray(prevOutput.length);
        cache.prevBuf.set(prevOutput);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, cache.prevBuf);
      }

      drawPass(gl, null, width, height, cache.eink, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.eink.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.uniform1i(cache.eink.uniforms.u_prev, 1);
        gl.uniform2f(cache.eink.uniforms.u_res, width, height);
        gl.uniform1i(cache.eink.uniforms.u_hasPrev, hasPrev ? 1 : 0);
        gl.uniform1i(cache.eink.uniforms.u_isColor, isColor ? 1 : 0);
        gl.uniform1f(cache.eink.uniforms.u_contrast, contrast);
        gl.uniform1f(cache.eink.uniforms.u_inkBlack, inkBlack);
        gl.uniform1f(cache.eink.uniforms.u_paperWhite, paperWhite);
        gl.uniform1f(cache.eink.uniforms.u_colorSaturation, colorSaturation);
        gl.uniform1f(cache.eink.uniforms.u_texture, texture);
        gl.uniform1i(cache.eink.uniforms.u_pixelGrid, pixelGrid ? 1 : 0);
        gl.uniform1i(cache.eink.uniforms.u_phase, phase);
        gl.uniform1i(cache.eink.uniforms.u_isFullRefresh, isFullRefresh ? 1 : 0);
        gl.uniform1i(cache.eink.uniforms.u_isAnimLoop, isAnimLoop ? 1 : 0);
        gl.uniform1f(cache.eink.uniforms.u_ghosting, ghosting);
        gl.uniform1i(cache.eink.uniforms.u_refreshIsPartial, refreshMode === REFRESH_PARTIAL ? 1 : 0);
      }, vao);

      const rendered = readoutToCanvas(canvas, width, height);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
        if (output) {
          logFilterBackend("E-ink", "WebGL2", `${mode} ${refreshMode} phase=${phase}${identity ? "" : "+palettePass"}`);
          return output;
        }
      }
    }
  }

  logFilterWasmStatus("E-ink", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputContext = input.getContext("2d");
  const outputContext = output.getContext("2d");
  if (!inputContext || !outputContext) return input;
  const source = inputContext.getImageData(0, 0, width, height).data;
  const result = new Uint8ClampedArray(source.length);
  const hasPrev = Boolean(prevOutput && prevOutput.length === result.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = getBufferIndex(x, y, width);
      result[index + 3] = source[index + 3];
      if (isFullRefresh && isAnimLoop && phase < 2) {
        const drive = (phase === 0 ? paperWhite : inkBlack) * 255;
        result[index] = drive;
        result[index + 1] = drive;
        result[index + 2] = drive;
        continue;
      }

      const sampleX = isColor ? Math.min(kaleidoColorCell(x), width - 1) : x;
      const sampleY = isColor ? Math.min(kaleidoColorCell(y), height - 1) : y;
      const sampleIndex = getBufferIndex(sampleX, sampleY, width);
      const grain = (paperNoise(x, y) - 0.5) * texture;
      const target = opticalTarget(source, sampleIndex, isColor, contrast, inkBlack, paperWhite, colorSaturation, grain);
      if (isColor && pixelGrid && (x % 3 === 0 || y % 3 === 0)) {
        target[0] *= 0.92;
        target[1] *= 0.92;
        target[2] *= 0.92;
      }
      const previousGray = hasPrev
        ? prevOutput![index] * 0.2126 + prevOutput![index + 1] * 0.7152 + prevOutput![index + 2] * 0.0722
        : 0;
      for (let channel = 0; channel < 3; channel += 1) {
        result[index + channel] = refreshMode === REFRESH_PARTIAL && hasPrev && ghosting > 0
          ? partialResidual(target[channel], isColor ? prevOutput![index + channel] : previousGray, ghosting)
          : target[channel];
      }
    }
  }

  outputContext.putImageData(new ImageData(result, width, height), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  return applyPalettePassToCanvas(output, width, height, palette) ?? output;
};

export default defineFilter({
  name: "E-ink",
  func: eink,
  options: defaults,
  optionTypes,
  defaults,
  description: "Reflective Carta/Kaleido proxy with 16 optical states, coarse color cells, waveform clears, and partial-update residuals.",
  temporal: true,
});
