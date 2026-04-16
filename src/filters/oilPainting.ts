import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmOilPaintingBuffer,
  wasmIsLoaded,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity as paletteIsIdentityShared } from "palettes/backend";
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
  radius: { type: RANGE, range: [1, 12], step: 1, default: 4, desc: "Brush stroke radius" },
  levels: { type: RANGE, range: [4, 30], step: 1, default: 20, desc: "Color quantization levels for paint effect" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  levels: optionTypes.levels.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Per-pixel luminance histogram over the neighborhood — each bin
// accumulates (R, G, B, count). Pick the most populated bin and emit its
// average colour. The CPU/WASM path does the same thing; fragment shaders
// support dynamic indexing into fixed-size arrays in GLSL ES 3.00, so we
// keep a vec4[30] on the stack and walk it through the neighbourhood.
const OIL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;
uniform int   u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // (R*255, G*255, B*255, count) per bin.
  vec4 bins[30];
  for (int i = 0; i < 30; i++) bins[i] = vec4(0.0);

  for (int ky = -12; ky <= 12; ky++) {
    if (ky < -u_radius || ky > u_radius) continue;
    for (int kx = -12; kx <= 12; kx++) {
      if (kx < -u_radius || kx > u_radius) continue;
      float nx = clamp(x + float(kx), 0.0, u_res.x - 1.0);
      float ny = clamp(y + float(ky), 0.0, u_res.y - 1.0);
      vec2 uv = vec2((nx + 0.5) / u_res.x, 1.0 - (ny + 0.5) / u_res.y);
      vec3 c = texture(u_source, uv).rgb;
      float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      int bin = int(clamp(floor(lum * float(u_levels)), 0.0, float(u_levels - 1)));
      bins[bin] += vec4(c * 255.0, 1.0);
    }
  }

  int maxBin = 0;
  float maxCount = bins[0].w;
  for (int b = 1; b < 30; b++) {
    if (b >= u_levels) break;
    if (bins[b].w > maxCount) {
      maxCount = bins[b].w;
      maxBin = b;
    }
  }

  vec4 pick = bins[0];
  for (int b = 0; b < 30; b++) {
    if (b == maxBin) pick = bins[b];
  }

  vec3 rgb;
  if (pick.w < 0.5) {
    // No samples (shouldn't happen with any radius ≥ 0), pass through.
    vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
    rgb = texture(u_source, suv).rgb;
  } else {
    rgb = (pick.rgb / pick.w) / 255.0;
  }
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float a = texture(u_source, suv).a;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

type Cache = { oil: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    oil: linkProgram(gl, OIL_FS, [
      "u_source", "u_res", "u_radius", "u_levels",
    ] as const),
  };
  return _cache;
};

const oilPainting = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { radius, levels, palette } = options;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "oilPainting:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.oil, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.oil.uniforms.u_source, 0);
        gl.uniform2f(cache.oil.uniforms.u_res, W, H);
        gl.uniform1i(cache.oil.uniforms.u_radius, Math.max(1, Math.min(12, Math.round(radius))));
        gl.uniform1i(cache.oil.uniforms.u_levels, Math.max(4, Math.min(30, Math.round(levels))));
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentityShared(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Oil Painting", "WebGL2",
            `r=${radius} lvl=${levels}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmOilPaintingBuffer(buf, outBuf, W, H, radius, levels);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
      }
    }
    logFilterWasmStatus("Oil Painting", true, paletteIsIdentity ? `r=${radius}` : `r=${radius}+palettePass`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Oil Painting", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  const binCount = new Int32Array(levels);
  const binR = new Float64Array(levels);
  const binG = new Float64Array(levels);
  const binB = new Float64Array(levels);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      binCount.fill(0);
      binR.fill(0);
      binG.fill(0);
      binB.fill(0);

      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const si = getBufferIndex(nx, ny, W);
          const r = buf[si], g = buf[si + 1], b = buf[si + 2];
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const bin = Math.min(levels - 1, Math.floor(lum * levels));
          binCount[bin]++;
          binR[bin] += r;
          binG[bin] += g;
          binB[bin] += b;
        }
      }

      let maxBin = 0;
      for (let b = 1; b < levels; b++) {
        if (binCount[b] > binCount[maxBin]) maxBin = b;
      }

      const count = binCount[maxBin];
      const i = getBufferIndex(x, y, W);
      if (count === 0) {
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        continue;
      }

      const r = Math.round(binR[maxBin] / count);
      const g = Math.round(binG[maxBin] / count);
      const b = Math.round(binB[maxBin] / count);

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Oil Painting",
  func: oilPainting,
  optionTypes,
  options: defaults,
  defaults
});
