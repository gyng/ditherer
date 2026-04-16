import { BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
  wasmApplyChannelLut,
  wasmIsLoaded,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
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
  perChannel: { type: BOOL, default: false, desc: "Equalize each RGB channel independently" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  perChannel: optionTypes.perChannel.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const buildCdf = (hist: number[], total: number): number[] => {
  const cdf: number[] = new Array(256).fill(0);
  let cumulative = 0;
  let cdfMin = -1;
  for (let i = 0; i < 256; i += 1) {
    cumulative += hist[i];
    cdf[i] = cumulative;
    if (cdfMin < 0 && cumulative > 0) cdfMin = cumulative;
  }
  // Normalize: map cdf value to 0-255
  const range = total - cdfMin;
  return cdf.map(v => (range > 0 ? Math.round(((v - cdfMin) / range) * 255) : 0));
};

// Shader applies a 256-entry luma LUT: compute luminance per pixel, look up
// mapped luma, scale RGB by mapped/original ratio. The histogram itself is
// a reduction the CPU builds in one pass.
const HEQ_LUMA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_lut;      // 256×1 R8 CDF
uniform float u_levels;

float lutSample(float v) {
  int idx = int(clamp(floor(v * 255.0 + 0.5), 0.0, 255.0));
  return texelFetch(u_lut, ivec2(idx, 0), 0).r;
}

void main() {
  vec4 c = texture(u_source, v_uv);
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float mapped = lutSample(lum);
  float scale = lum > 1.0 / 255.0 ? mapped / lum : 1.0;
  vec3 rgb = clamp(c.rgb * scale, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type GLCache = { lumaProg: Program; lutTex: WebGLTexture | null };
let _glCache: GLCache | null = null;

const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    lumaProg: linkProgram(gl, HEQ_LUMA_FS, ["u_source", "u_lut", "u_levels"] as const),
    lutTex: null,
  };
  return _glCache;
};

const ensureLutTex = (gl: WebGL2RenderingContext, cache: GLCache): WebGLTexture | null => {
  if (cache.lutTex) return cache.lutTex;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  cache.lutTex = tex;
  return tex;
};

const histogramEqualization = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { perChannel, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const total = W * H;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;
  const wasmAvailable = wasmIsLoaded() && options._wasmAcceleration !== false;

  let mapR: number[], mapG: number[], mapB: number[];

  if (perChannel) {
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    for (let i = 0; i < buf.length; i += 4) {
      histR[buf[i]] += 1;
      histG[buf[i + 1]] += 1;
      histB[buf[i + 2]] += 1;
    }
    mapR = buildCdf(histR, total);
    mapG = buildCdf(histG, total);
    mapB = buildCdf(histB, total);
  } else {
    // Equalize luminance channel only, preserve hue
    const histL = new Array(256).fill(0);
    for (let i = 0; i < buf.length; i += 4) {
      const lum = Math.round(buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722);
      histL[lum] += 1;
    }
    const cdfL = buildCdf(histL, total);
    // Store as shared map (applied via luminance scaling below)
    mapR = mapG = mapB = cdfL;
  }

  const outBuf = new Uint8ClampedArray(buf.length);

  // GL path for luma mode: CPU-built CDF uploaded as a 256×1 R8 LUT,
  // shader does the per-pixel luma-scale remap.
  if (!perChannel && glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initGLCache(gl);
      const vao = getQuadVAO(gl);
      const lutTex = ensureLutTex(gl, cache);
      if (lutTex) {
        resizeGLCanvas(canvas, W, H);
        const sourceTex = ensureTexture(gl, "histEq:source", W, H);
        uploadSourceTexture(gl, sourceTex, input);

        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(mapR));
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        drawPass(gl, null, W, H, cache.lumaProg, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.lumaProg.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, lutTex);
          gl.uniform1i(cache.lumaProg.uniforms.u_lut, 1);
          const identity = paletteIsIdentityShared(palette);
          const pOpts = (palette as { options?: { levels?: number } }).options;
          gl.uniform1f(cache.lumaProg.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const identity = paletteIsIdentityShared(palette);
          const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("Histogram equalization", "WebGL2",
              `luma${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }

  // Per-channel mode: collapses to three independent 256-entry LUTs — direct
  // fit for apply_channel_lut. Luma mode requires per-pixel scaling that cross-
  // mixes channels, so it stays on JS.
  if (wasmAvailable && perChannel) {
    const lutR = new Uint8Array(mapR);
    const lutG = new Uint8Array(mapG);
    const lutB = new Uint8Array(mapB);
    wasmApplyChannelLut(buf, outBuf, lutR, lutG, lutB);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const col = srgbPaletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options);
        fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
      }
    }
    logFilterWasmStatus("Histogram equalization", true, paletteIsIdentity ? "perChannel lut" : "perChannel lut+palettePass");
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  logFilterWasmStatus("Histogram equalization", false, perChannel ? (options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet") : "luma mode");

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      let r: number, g: number, b: number;

      if (perChannel) {
        r = mapR[buf[i]];
        g = mapG[buf[i + 1]];
        b = mapB[buf[i + 2]];
      } else {
        const lum = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
        const lumIdx = Math.round(lum);
        const scale = lum > 0 ? mapR[lumIdx] / lum : 1;
        r = Math.min(255, Math.round(buf[i] * scale));
        g = Math.min(255, Math.round(buf[i + 1] * scale));
        b = Math.min(255, Math.round(buf[i + 2] * scale));
      }

      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Histogram equalization",
  func: histogramEqualization,
  options: defaults,
  optionTypes,
  defaults
});
