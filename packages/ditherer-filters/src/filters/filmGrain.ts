import { ACTION, RANGE, BOOL, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { filmDensityNoise, filmGrainAmplitude } from "./analogFilmQualityContracts";
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

export const optionTypes = {
  amount: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.16,
    desc: "RMS-like density fluctuation strength — strongest in middle tones",
  },
  size: {
    type: RANGE,
    range: [1, 4],
    step: 0.5,
    default: 1,
    desc: "Diameter of smoothly correlated grain clusters in output pixels",
  },
  monochrome: {
    type: BOOL,
    default: true,
    desc: "Use one silver-like density field; off adds partially correlated color-layer dye clouds",
  },
  animSpeed: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 15,
    desc: "Frame rate for moving motion-picture grain",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Animate independent grain exposure for each motion-picture frame",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
      }
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  amount: optionTypes.amount.default,
  size: optionTypes.size.default,
  monochrome: optionTypes.monochrome.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const FG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_amount;
uniform float u_size;
uniform int   u_monochrome;
uniform float u_seed;
uniform float u_levels;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 smoothF = f * f * (3.0 - 2.0 * f);
  float a = hash(cell, seed);
  float b = hash(cell + vec2(1.0, 0.0), seed);
  float c = hash(cell + vec2(0.0, 1.0), seed);
  float d = hash(cell + vec2(1.0, 1.0), seed);
  return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
}

float densityNoise(vec2 p, float seed) {
  float sum = vnoise(p, seed)
            + vnoise(p + vec2(19.1, 7.3), seed + 11.0)
            + vnoise(p + vec2(3.7, 29.9), seed + 29.0)
            + vnoise(p + vec2(41.3, 17.7), seed + 47.0);
  return (sum - 2.0) * 0.5;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);

  vec2 grainCoord = vec2(x, y) / max(u_size, 1.0);
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float envelope = 0.2 + 0.8 * sqrt(max(0.0, 4.0 * luma * (1.0 - luma)));
  float amplitude = u_amount * 0.25 * envelope;

  vec3 noise;
  if (u_monochrome == 1) {
    float n = densityNoise(grainCoord, u_seed) * amplitude;
    noise = vec3(n);
  } else {
    float shared = densityNoise(grainCoord, u_seed);
    noise = vec3(
      mix(shared, densityNoise(grainCoord, u_seed + 101.0), 0.35),
      mix(shared, densityNoise(grainCoord, u_seed + 211.0), 0.35),
      mix(shared, densityNoise(grainCoord, u_seed + 307.0), 0.35)
    ) * amplitude;
  }

  vec3 rgb = clamp(c.rgb + noise, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { fg: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    fg: linkProgram(gl, FG_FS, [
      "u_source",
      "u_res",
      "u_amount",
      "u_size",
      "u_monochrome",
      "u_seed",
      "u_levels",
    ] as const),
  };
  return _cache;
};

type FilmGrainOptions = Partial<typeof defaults> & {
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

const filmGrain = (input: any, options: FilmGrainOptions = defaults) => {
  const {
    amount = defaults.amount,
    size = defaults.size,
    monochrome = defaults.monochrome,
    palette = defaults.palette,
  } = options;
  const frameIndex = options._frameIndex ?? 0;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "filmGrain:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(
        gl,
        null,
        W,
        H,
        cache.fg,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.fg.uniforms.u_source, 0);
          gl.uniform2f(cache.fg.uniforms.u_res, W, H);
          gl.uniform1f(cache.fg.uniforms.u_amount, amount);
          gl.uniform1f(cache.fg.uniforms.u_size, size);
          gl.uniform1i(cache.fg.uniforms.u_monochrome, monochrome ? 1 : 0);
          gl.uniform1f(cache.fg.uniforms.u_seed, ((frameIndex * 7919) % 1000000) * 0.001);
          const identity = paletteIsIdentity(palette);
          const pOpts = (palette as { options?: { levels?: number } }).options;
          gl.uniform1f(cache.fg.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend(
            "Film Grain",
            "WebGL2",
            `amount=${amount} size=${size}${identity ? "" : "+palettePass"}`,
          );
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Film Grain", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      const grainX = x / Math.max(size, 1);
      const grainY = y / Math.max(size, 1);
      const seed = frameIndex * 7919;
      const luma = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      const amplitude = filmGrainAmplitude(luma, amount) * 255;
      const shared = filmDensityNoise(grainX, grainY, seed);

      let nr: number, ng: number, nb: number;
      if (monochrome) {
        const n = shared * amplitude;
        nr = n;
        ng = n;
        nb = n;
      } else {
        nr = (shared * 0.65 + filmDensityNoise(grainX, grainY, seed + 101) * 0.35) * amplitude;
        ng = (shared * 0.65 + filmDensityNoise(grainX, grainY, seed + 211) * 0.35) * amplitude;
        nb = (shared * 0.65 + filmDensityNoise(grainX, grainY, seed + 307) * 0.35) * amplitude;
      }

      const r = Math.max(0, Math.min(255, Math.round(buf[i] + nr)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] + ng)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] + nb)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Film Grain",
  func: filmGrain,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Density-aware film granularity with smooth random dye-cloud clusters, correlated color layers, and optional per-frame motion",
  temporal: true,
});
