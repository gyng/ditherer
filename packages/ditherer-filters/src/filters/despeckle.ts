import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
  releasePooledCanvas,
} from "../utils/index";
import { normalizeRangeOption } from "../utils/filterOptions";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { channelMedian, thresholdedMedianPick } from "./opticalConvolutionContracts";
import { renderMedianFilterGL, medianFilterGLAvailable } from "./medianFilterGL";
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
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "How far a pixel must deviate from its neighbourhood median to be treated as speckle" },
  radius: { type: RANGE, range: [1, 5], step: 1, default: 2, desc: "Neighborhood radius for the median" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Edge-preserving despeckle: replace a pixel with its per-channel neighbourhood
// median only when it deviates from that median by more than the threshold — so
// impulse (salt-and-pepper) speckle is removed while edges and detail survive.
// The median itself is computed by the shared, tested medianFilterGL histogram;
// this pass gates it against the source. (The previous filter box-blurred every
// high-variance pixel — i.e. it smeared edges and kept flat noise.)
const GATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_median;
uniform vec2  u_res;
uniform float u_threshold;   // 0..255
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 src = texture(u_source, suv);
  vec3 s = src.rgb * 255.0;
  vec3 m = texture(u_median, suv).rgb * 255.0;
  vec3 d = abs(s - m);
  // Per channel: outlier (|s-m| > threshold) takes the median, else keeps s.
  vec3 pick = mix(s, m, step(u_threshold + 0.5, d));
  vec3 rgb = clamp(pick / 255.0, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { gate: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    gate: linkProgram(gl, GATE_FS, [
      "u_source", "u_median", "u_res", "u_threshold", "u_levels",
    ] as const),
  };
  return _cache;
};

const despeckle = (input: any, options: Partial<typeof defaults> = defaults) => {
  const threshold = normalizeRangeOption(options.threshold, defaults.threshold, 0, 50);
  const radius = normalizeRangeOption(options.radius, defaults.radius, 1, 5, true);
  const palette = options.palette ?? defaults.palette;
  const W = input.width, H = input.height;

  if (glAvailable() && medianFilterGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const median = renderMedianFilterGL(input, W, H, radius);
    const ctx = getGLCtx();
    if (median && ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "despeckle:source", W, H);
      const medianTex = ensureTexture(gl, "despeckle:median", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      uploadSourceTexture(gl, medianTex, median);
      // median is a pooled canvas consumed synchronously by the upload above;
      // return it so despeckle's own readout can reuse it instead of churning.
      releasePooledCanvas(median);

      drawPass(gl, null, W, H, cache.gate, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.gate.uniforms.u_source, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, medianTex.tex);
        gl.uniform1i(cache.gate.uniforms.u_median, 1);
        gl.uniform2f(cache.gate.uniforms.u_res, W, H);
        gl.uniform1f(cache.gate.uniforms.u_threshold, threshold);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.gate.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Despeckle", "WebGL2",
            `r=${radius} thresh=${threshold}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Despeckle", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const r = new Array<number>(), g = new Array<number>(), b = new Array<number>();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      r.length = 0; g.length = 0; b.length = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          r.push(buf[ni]); g.push(buf[ni + 1]); b.push(buf[ni + 2]);
        }
      }
      const pr = thresholdedMedianPick(buf[i], channelMedian(r), threshold);
      const pg = thresholdedMedianPick(buf[i + 1], channelMedian(g), threshold);
      const pb = thresholdedMedianPick(buf[i + 2], channelMedian(b), threshold);
      const color = paletteGetColor(palette, rgba(Math.round(pr), Math.round(pg), Math.round(pb), buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Despeckle", func: despeckle, optionTypes, options: defaults, defaults });
