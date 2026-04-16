import { RANGE, PALETTE } from "constants/controlTypes";
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
import { defineFilter } from "filters/types";
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
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "Difference threshold to detect speckle noise" },
  radius: { type: RANGE, range: [1, 5], step: 1, default: 2, desc: "Neighborhood radius for median sampling" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Per-pixel variance-gated local mean: regions with high per-channel
// variance (noisy) are smoothed to the neighbourhood mean, low-variance
// (structured) regions keep their original value. All pixel values are
// handled in 0..255 space in the shader to match the CPU threshold.
const DESPECKLE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_threshSq;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 sum = vec3(0.0);
  vec3 sum2 = vec3(0.0);
  float count = 0.0;
  for (int ky = -5; ky <= 5; ky++) {
    if (ky < -u_radius || ky > u_radius) continue;
    for (int kx = -5; kx <= 5; kx++) {
      if (kx < -u_radius || kx > u_radius) continue;
      float nx = clamp(x + float(kx), 0.0, u_res.x - 1.0);
      float ny = clamp(y + float(ky), 0.0, u_res.y - 1.0);
      vec2 uv = vec2((nx + 0.5) / u_res.x, 1.0 - (ny + 0.5) / u_res.y);
      vec3 c = texture(u_source, uv).rgb * 255.0;
      sum += c;
      sum2 += c * c;
      count += 1.0;
    }
  }
  vec3 mean = sum / count;
  vec3 varv = sum2 / count - mean * mean;
  float variance = (varv.r + varv.g + varv.b) / 3.0;

  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 self = texture(u_source, suv);
  vec3 pick = variance > u_threshSq ? mean : self.rgb * 255.0;
  vec3 rgb = clamp(pick / 255.0, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, self.a);
}
`;

type Cache = { desp: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    desp: linkProgram(gl, DESPECKLE_FS, [
      "u_source", "u_res", "u_radius", "u_threshSq", "u_levels",
    ] as const),
  };
  return _cache;
};

const despeckle = (input: any, options = defaults) => {
  const { threshold, radius, palette } = options;
  const W = input.width, H = input.height;
  const threshSq = threshold * threshold;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "despeckle:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.desp, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.desp.uniforms.u_source, 0);
        gl.uniform2f(cache.desp.uniforms.u_res, W, H);
        gl.uniform1i(cache.desp.uniforms.u_radius, Math.max(1, Math.min(5, Math.round(radius))));
        gl.uniform1f(cache.desp.uniforms.u_threshSq, threshSq);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.desp.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
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

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      let sumR = 0, sumG = 0, sumB = 0;
      let sumR2 = 0, sumG2 = 0, sumB2 = 0;
      let count = 0;

      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          sumR += buf[ni]; sumG += buf[ni + 1]; sumB += buf[ni + 2];
          sumR2 += buf[ni] * buf[ni]; sumG2 += buf[ni + 1] * buf[ni + 1]; sumB2 += buf[ni + 2] * buf[ni + 2];
          count++;
        }
      }

      const meanR = sumR / count, meanG = sumG / count, meanB = sumB / count;
      const varR = sumR2 / count - meanR * meanR;
      const varG = sumG2 / count - meanG * meanG;
      const varB = sumB2 / count - meanB * meanB;
      const variance = (varR + varG + varB) / 3;

      if (variance > threshSq) {
        const color = paletteGetColor(palette, rgba(Math.round(meanR), Math.round(meanG), Math.round(meanB), buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      } else {
        const color = paletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Despeckle", func: despeckle, optionTypes, options: defaults, defaults });
