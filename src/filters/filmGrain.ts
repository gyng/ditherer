import { ACTION, RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
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

export const optionTypes = {
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Intensity of the grain noise overlay" },
  size: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Grain particle size in pixels" },
  monochrome: { type: BOOL, default: true, desc: "Use uniform grayscale noise instead of color noise" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amount: optionTypes.amount.default,
  size: optionTypes.size.default,
  monochrome: optionTypes.monochrome.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
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

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);

  float bx = floor(x / max(u_size, 1.0));
  float by = floor(y / max(u_size, 1.0));
  vec2 blockCoord = vec2(bx, by);

  vec3 noise;
  if (u_monochrome == 1) {
    float n = (hash(blockCoord, u_seed) - 0.5) * 2.0 * u_amount;
    noise = vec3(n);
  } else {
    float nr = (hash(blockCoord, u_seed + 1.0) - 0.5) * 2.0 * u_amount;
    float ng = (hash(blockCoord, u_seed + 2.0) - 0.5) * 2.0 * u_amount;
    float nb = (hash(blockCoord, u_seed + 3.0) - 0.5) * 2.0 * u_amount;
    noise = vec3(nr, ng, nb);
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
      "u_source", "u_res", "u_amount", "u_size",
      "u_monochrome", "u_seed", "u_levels",
    ] as const),
  };
  return _cache;
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

const filmGrain = (input: any, options = defaults) => {
  const { amount, size, monochrome, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
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

      drawPass(gl, null, W, H, cache.fg, () => {
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
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Film Grain", "WebGL2",
            `amount=${amount} size=${size}${identity ? "" : "+palettePass"}`);
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

      const bx = Math.floor(x / size);
      const by = Math.floor(y / size);

      const blockSeed = bx * 31 + by * 997 + frameIndex * 7919;
      const blockRng = mulberry32(blockSeed);

      let nr: number, ng: number, nb: number;
      if (monochrome) {
        const n = (blockRng() - 0.5) * 2 * amount * 255;
        nr = n; ng = n; nb = n;
      } else {
        nr = (blockRng() - 0.5) * 2 * amount * 255;
        ng = (blockRng() - 0.5) * 2 * amount * 255;
        nb = (blockRng() - 0.5) * 2 * amount * 255;
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
  defaults
});
