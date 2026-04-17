import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
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
} from "gl";

const EINK_GRAYSCALE = "GRAYSCALE";
const EINK_COLOR = "COLOR";
const REFRESH_FULL = "FULL";
const REFRESH_PARTIAL = "PARTIAL";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Grayscale (16-level)", value: EINK_GRAYSCALE },
      { name: "Color (Kaleido/Gallery)", value: EINK_COLOR }
    ],
    default: EINK_GRAYSCALE,
    desc: "E-ink display type to emulate"
  },
  refreshMode: {
    type: ENUM,
    options: [
      { name: "Full (flash clear)", value: REFRESH_FULL },
      { name: "Partial (fast, more ghosting)", value: REFRESH_PARTIAL }
    ],
    default: REFRESH_PARTIAL,
    desc: "Screen refresh method — real devices typically use partial updates and occasional full clears"
  },
  fullRefreshEvery: {
    type: RANGE,
    range: [6, 240],
    step: 1,
    default: 72,
    desc: "In Full mode with video input, run a full flash cycle every N frames instead of every update"
  },
  contrast: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1.2, desc: "Display contrast multiplier" },
  paperWhite: { type: RANGE, range: [180, 255], step: 1, default: 230, desc: "Brightest displayable value" },
  inkBlack: { type: RANGE, range: [0, 80], step: 1, default: 15, desc: "Darkest displayable value" },
  ghosting: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Previous-frame ghosting intensity" },
  pixelGrid: { type: BOOL, default: true, desc: "Show subtle pixel grid lines" },
  texture: { type: RANGE, range: [0, 0.3], step: 0.01, default: 0.06, desc: "Paper surface texture grain" },
  pageRefresh: {
    type: ACTION,
    label: "Page refresh",
    action: (actions: any, inputCanvas: any) => {
      actions.triggerBurst(inputCanvas, 10, 4);
    }
  },
  refreshRate: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Screen refresh speed (frames per second)" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.refreshRate || 2);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  refreshMode: optionTypes.refreshMode.default,
  fullRefreshEvery: optionTypes.fullRefreshEvery.default,
  contrast: optionTypes.contrast.default,
  paperWhite: optionTypes.paperWhite.default,
  inkBlack: optionTypes.inkBlack.default,
  ghosting: optionTypes.ghosting.default,
  pixelGrid: optionTypes.pixelGrid.default,
  texture: optionTypes.texture.default,
  refreshRate: optionTypes.refreshRate.default,
  palette: { ...optionTypes.palette.default, options: { levels: 16 } }
};

type EinkPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type EinkOptions = FilterOptionValues & {
  mode?: string;
  refreshMode?: string;
  fullRefreshEvery?: number;
  contrast?: number;
  paperWhite?: number;
  inkBlack?: number;
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

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const computePixel = (
  buf: Uint8ClampedArray, i: number,
  isColor: boolean, contrast: number,
  inkBlack: number, range: number,
  texNoise: number
): [number, number, number] => {
  const luma = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
  const contLuma = Math.max(0, Math.min(255, 128 + (luma - 128) * contrast));
  const mappedLuma = inkBlack + (contLuma / 255) * range;

  if (isColor) {
    const colorSat = 0.35;
    const cR = buf[i] - luma;
    const cG = buf[i + 1] - luma;
    const cB = buf[i + 2] - luma;
    return [
      Math.max(0, Math.min(255, Math.round((mappedLuma + cR * colorSat + texNoise) / 64) * 64)),
      Math.max(0, Math.min(255, Math.round((mappedLuma + cG * colorSat + texNoise) / 64) * 64)),
      Math.max(0, Math.min(255, Math.round((mappedLuma + cB * colorSat + texNoise) / 64) * 64))
    ];
  }

  const mapped = mappedLuma + texNoise;
  const step = range / 15;
  const quantized = inkBlack + Math.round((mapped - inkBlack) / step) * step;
  const v = Math.max(0, Math.min(255, quantized));
  return [v, v, v];
};

// Phase flags: 0 = drive-white flash, 1 = drive-black flash, 2 = invert,
// 3+ = normal settled output. Branching on this is cheap compared to the
// per-pixel quantize/grid/ghost work, so it stays in-shader.
const EINK_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prev;    // previous output (RGBA8)
uniform vec2  u_res;
uniform int   u_hasPrev;
uniform int   u_isColor;
uniform float u_contrast;
uniform float u_inkBlack;
uniform float u_range;
uniform float u_paperWhite;
uniform float u_texture;
uniform int   u_pixelGrid;
uniform int   u_phase;       // 0,1,2 during animated full refresh; 3 = normal
uniform int   u_isFullRefresh;
uniform int   u_isAnimLoop;
uniform float u_ghosting;
uniform int   u_refreshIsPartial;
uniform float u_seed;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 computePixel(vec3 srcRGB, float texNoise) {
  vec3 rgb255 = srcRGB * 255.0;
  float luma = 0.2126 * rgb255.r + 0.7152 * rgb255.g + 0.0722 * rgb255.b;
  float contLuma = clamp(128.0 + (luma - 128.0) * u_contrast, 0.0, 255.0);
  float mappedLuma = u_inkBlack + (contLuma / 255.0) * u_range;

  if (u_isColor == 1) {
    float colorSat = 0.35;
    vec3 delta = rgb255 - vec3(luma);
    vec3 quantized = floor((mappedLuma + delta * colorSat + texNoise) / 64.0 + 0.5) * 64.0;
    return clamp(quantized, 0.0, 255.0);
  }
  float mapped = mappedLuma + texNoise;
  float step = u_range / 15.0;
  float q = u_inkBlack + floor((mapped - u_inkBlack) / step + 0.5) * step;
  return vec3(clamp(q, 0.0, 255.0));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 src = texture(u_source, suv);

  // Full-refresh flash phases: drive everything white / black.
  if (u_isFullRefresh == 1 && u_isAnimLoop == 1) {
    if (u_phase == 0) {
      fragColor = vec4(vec3(u_paperWhite) / 255.0, 1.0);
      return;
    }
    if (u_phase == 1) {
      fragColor = vec4(vec3(u_inkBlack) / 255.0, 1.0);
      return;
    }
  }

  float texNoise = u_texture > 0.0 ? (hash(vec2(x, y), u_seed) - 0.5) * u_texture * u_range : 0.0;
  vec3 pixel = computePixel(src.rgb, texNoise);

  // Settle/invert phase (2): briefly show inverted before settling.
  if (u_isAnimLoop == 1 && u_isFullRefresh == 1 && u_phase == 2) {
    pixel = max(vec3(0.0), vec3(u_paperWhite) - (pixel - vec3(u_inkBlack)));
  }

  vec3 rgb = pixel / 255.0;

  if (u_pixelGrid == 1 && (mod(x, 3.0) < 0.5 || mod(y, 3.0) < 0.5)) {
    rgb *= 0.92;
  }

  // Ghosting: blend with previous output. Full-refresh flashes clear it.
  bool isClearing = (u_isAnimLoop == 1) && (u_isFullRefresh == 1) && (u_phase < 2);
  if (u_ghosting > 0.0 && u_hasPrev == 1 && !isClearing) {
    float ghostAmt = u_refreshIsPartial == 1 ? u_ghosting * 1.5 : u_ghosting;
    float keep = min(1.0, ghostAmt);
    float fresh = 1.0 - keep;
    vec4 prev = texture(u_prev, suv);
    rgb = clamp(rgb * fresh + prev.rgb * keep, 0.0, 1.0);
  }

  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { eink: Program; prevTex: WebGLTexture | null; prevBuf: Uint8ClampedArray | null; w: number; h: number };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    eink: linkProgram(gl, EINK_FS, [
      "u_source", "u_prev", "u_res", "u_hasPrev", "u_isColor",
      "u_contrast", "u_inkBlack", "u_range", "u_paperWhite", "u_texture",
      "u_pixelGrid", "u_phase", "u_isFullRefresh", "u_isAnimLoop",
      "u_ghosting", "u_refreshIsPartial", "u_seed",
    ] as const),
    prevTex: null, prevBuf: null, w: 0, h: 0,
  };
  return _cache;
};

const ensurePrevTex = (gl: WebGL2RenderingContext, cache: Cache, w: number, h: number) => {
  if (cache.prevTex && cache.w === w && cache.h === h) return cache.prevTex;
  if (cache.prevTex) gl.deleteTexture(cache.prevTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.prevTex = tex;
  cache.w = w;
  cache.h = h;
  cache.prevBuf = null;
  return tex;
};

const eink = (
  input: any,
  options: EinkOptions = defaults
) => {
  const {
    mode = defaults.mode,
    refreshMode = defaults.refreshMode,
    contrast = defaults.contrast,
    paperWhite = defaults.paperWhite,
    inkBlack = defaults.inkBlack,
    fullRefreshEvery = defaults.fullRefreshEvery,
    ghosting = defaults.ghosting,
    pixelGrid = defaults.pixelGrid,
    texture = defaults.texture,
    palette = defaults.palette,
  } = options;

  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const isAnimLoop = Boolean(options._isAnimating);
  const hasVideoInput = Boolean(options._hasVideoInput);

  const W = input.width;
  const H = input.height;

  const isColor = mode === EINK_COLOR;
  const range = paperWhite - inkBlack;
  const isFullRefresh = refreshMode === REFRESH_FULL;
  const videoRefreshInterval = Math.max(3, Math.round(fullRefreshEvery || 72));
  const refreshCycle = isFullRefresh ? 6 : 2;
  let phase = refreshCycle;
  if (isAnimLoop) {
    if (isFullRefresh && hasVideoInput) {
      const p = frameIndex % videoRefreshInterval;
      phase = p < 3 ? p : refreshCycle;
    } else {
      phase = frameIndex % refreshCycle;
    }
  }

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "eink:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const prevTex = ensurePrevTex(gl, cache, W, H);
      const hasPrev = !!(prevOutput && prevOutput.length === W * H * 4 && prevTex);
      if (hasPrev && prevTex && prevOutput) {
        if (!cache.prevBuf || cache.prevBuf.length !== prevOutput.length) {
          cache.prevBuf = new Uint8ClampedArray(prevOutput.length);
        }
        cache.prevBuf.set(prevOutput);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, cache.prevBuf);
      }

      drawPass(gl, null, W, H, cache.eink, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.eink.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.uniform1i(cache.eink.uniforms.u_prev, 1);
        gl.uniform2f(cache.eink.uniforms.u_res, W, H);
        gl.uniform1i(cache.eink.uniforms.u_hasPrev, hasPrev ? 1 : 0);
        gl.uniform1i(cache.eink.uniforms.u_isColor, isColor ? 1 : 0);
        gl.uniform1f(cache.eink.uniforms.u_contrast, contrast);
        gl.uniform1f(cache.eink.uniforms.u_inkBlack, inkBlack);
        gl.uniform1f(cache.eink.uniforms.u_range, range);
        gl.uniform1f(cache.eink.uniforms.u_paperWhite, paperWhite);
        gl.uniform1f(cache.eink.uniforms.u_texture, texture);
        gl.uniform1i(cache.eink.uniforms.u_pixelGrid, pixelGrid ? 1 : 0);
        gl.uniform1i(cache.eink.uniforms.u_phase, phase);
        gl.uniform1i(cache.eink.uniforms.u_isFullRefresh, isFullRefresh ? 1 : 0);
        gl.uniform1i(cache.eink.uniforms.u_isAnimLoop, isAnimLoop ? 1 : 0);
        gl.uniform1f(cache.eink.uniforms.u_ghosting, ghosting);
        gl.uniform1i(cache.eink.uniforms.u_refreshIsPartial, refreshMode === REFRESH_PARTIAL ? 1 : 0);
        gl.uniform1f(cache.eink.uniforms.u_seed, ((frameIndex * 6131 + 997) % 1000000) * 0.001);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("E-ink", "WebGL2",
            `${mode} ${refreshMode} phase=${phase}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("E-ink", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 6131 + 997);

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = getBufferIndex(x, y, W);

      if (isFullRefresh && isAnimLoop) {
        if (phase === 0) {
          fillBufferPixel(outBuf, i, paperWhite, paperWhite, paperWhite, 255);
          continue;
        }
        if (phase === 1) {
          fillBufferPixel(outBuf, i, inkBlack, inkBlack, inkBlack, 255);
          continue;
        }
      }

      const texNoise = texture > 0 ? (rng() - 0.5) * texture * range : 0;
      const [r, g, b] = computePixel(buf, i, isColor, contrast, inkBlack, range, texNoise);

      if (isAnimLoop && isFullRefresh && phase === 2) {
        fillBufferPixel(outBuf, i,
          Math.max(0, paperWhite - (r - inkBlack)),
          Math.max(0, paperWhite - (g - inkBlack)),
          Math.max(0, paperWhite - (b - inkBlack)),
          255);
        continue;
      }

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  if (pixelGrid) {
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (x % 3 === 0 || y % 3 === 0) {
          const i = getBufferIndex(x, y, W);
          outBuf[i]     = Math.round(outBuf[i] * 0.92);
          outBuf[i + 1] = Math.round(outBuf[i + 1] * 0.92);
          outBuf[i + 2] = Math.round(outBuf[i + 2] * 0.92);
        }
      }
    }
  }

  if (ghosting > 0 && prevOutput && prevOutput.length === outBuf.length) {
    const isClearing = isAnimLoop && isFullRefresh && phase < 2;
    if (!isClearing) {
      const ghostAmount = refreshMode === REFRESH_PARTIAL ? ghosting * 1.5 : ghosting;
      const keep = Math.min(1, ghostAmount);
      const fresh = 1 - keep;
      for (let j = 0; j < outBuf.length; j += 4) {
        outBuf[j]     = Math.min(255, outBuf[j] * fresh + prevOutput[j] * keep);
        outBuf[j + 1] = Math.min(255, outBuf[j + 1] * fresh + prevOutput[j + 1] * keep);
        outBuf[j + 2] = Math.min(255, outBuf[j + 2] * fresh + prevOutput[j + 2] * keep);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "E-ink",
  func: eink,
  options: defaults,
  optionTypes,
  defaults,
});
