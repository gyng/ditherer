import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
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
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  ensureTexture,
  type Program,
} from "gl";

const PATTERN = {
  BAYER_8X8: "BAYER_8X8",
  BAYER_16X16: "BAYER_16X16",
  HALFTONE_DOT: "HALFTONE_DOT",
  DIAGONAL: "DIAGONAL",
  CROSS: "CROSS",
  DIAMOND: "DIAMOND"
};

const bayer8 = (() => {
  const m = new Float32Array(64);
  const bayer = (x: number, y: number, size: number): number => {
    if (size === 1) return 0;
    const half = size >> 1;
    const quadrant = (x >= half ? 1 : 0) + (y >= half ? 2 : 0);
    const offsets = [0, 2, 3, 1];
    return offsets[quadrant] + 4 * bayer(x % half, y % half, half);
  };
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      m[y * 8 + x] = bayer(x, y, 8) / 64;
  return m;
})();

const PATTERN_SIZE = 64;

const generatePattern = (type: string, size: number): { data: Float32Array; w: number; h: number } => {
  const s = size;
  const data = new Float32Array(s * s);

  switch (type) {
    case PATTERN.BAYER_8X8: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++)
          data[y * s + x] = bayer8[(y % 8) * 8 + (x % 8)];
      return { data, w: s, h: s };
    }
    case PATTERN.BAYER_16X16: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const bx = x % 16, by = y % 16;
          const b4 = bayer8[(by % 8) * 8 + (bx % 8)];
          const quadrant = (bx >= 8 ? 1 : 0) + (by >= 8 ? 2 : 0);
          data[y * s + x] = (b4 + [0, 2, 3, 1][quadrant]) / 4;
        }
      return { data, w: s, h: s };
    }
    case PATTERN.HALFTONE_DOT: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const cx = (x % 8) - 3.5, cy = (y % 8) - 3.5;
          data[y * s + x] = Math.sqrt(cx * cx + cy * cy) / 5;
        }
      return { data, w: s, h: s };
    }
    case PATTERN.DIAGONAL: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++)
          data[y * s + x] = ((x + y) % 8) / 8;
      return { data, w: s, h: s };
    }
    case PATTERN.CROSS: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const mx = Math.abs((x % 8) - 3.5);
          const my = Math.abs((y % 8) - 3.5);
          data[y * s + x] = Math.min(mx, my) / 3.5;
        }
      return { data, w: s, h: s };
    }
    case PATTERN.DIAMOND: {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const mx = Math.abs((x % 8) - 3.5);
          const my = Math.abs((y % 8) - 3.5);
          data[y * s + x] = (mx + my) / 7;
        }
      return { data, w: s, h: s };
    }
    default:
      data.fill(0.5);
      return { data, w: s, h: s };
  }
};

export const optionTypes = {
  pattern: {
    type: ENUM,
    options: [
      { name: "Bayer 8x8", value: PATTERN.BAYER_8X8 },
      { name: "Bayer 16x16", value: PATTERN.BAYER_16X16 },
      { name: "Halftone dot", value: PATTERN.HALFTONE_DOT },
      { name: "Diagonal", value: PATTERN.DIAGONAL },
      { name: "Cross", value: PATTERN.CROSS },
      { name: "Diamond", value: PATTERN.DIAMOND }
    ],
    default: PATTERN.BAYER_8X8,
    desc: "Threshold pattern shape"
  },
  scale: { type: RANGE, range: [1, 8], step: 1, default: 1, desc: "Pattern tile scale factor" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  pattern: optionTypes.pattern.default,
  scale: optionTypes.scale.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

type ThresholdMapOptions = FilterOptionValues & {
  pattern?: string;
  scale?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _webglAcceleration?: boolean;
};

// Shader samples a 64×64 R8 threshold texture and compares against per-pixel
// luminance. Pattern data is built on CPU and uploaded; the uniform holds the
// texture, so the shader itself is pattern-agnostic.
const TM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_pattern;
uniform vec2  u_res;
uniform float u_patternSize;
uniform float u_scale;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  float px_ = floor(x / max(u_scale, 1.0));
  float py_ = floor(y / max(u_scale, 1.0));
  float tx = mod(px_, u_patternSize);
  float ty = mod(py_, u_patternSize);
  float threshold = texelFetch(u_pattern, ivec2(int(tx), int(ty)), 0).r;

  float v = lum > threshold ? 1.0 : 0.0;
  fragColor = vec4(v, v, v, c.a);
}
`;

type Cache = { prog: Program; patternTex: WebGLTexture | null; patternKey: string };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, TM_FS, [
      "u_source", "u_pattern", "u_res", "u_patternSize", "u_scale",
    ] as const),
    patternTex: null,
    patternKey: "",
  };
  return _cache;
};

const ensurePatternTex = (gl: WebGL2RenderingContext, cache: Cache, pattern: string): WebGLTexture | null => {
  if (cache.patternTex && cache.patternKey === pattern) return cache.patternTex;
  if (!cache.patternTex) {
    const tex = gl.createTexture();
    if (!tex) return null;
    cache.patternTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  const { data } = generatePattern(pattern, PATTERN_SIZE);
  // Pack to Uint8 — patterns stored as 0..1 floats, fine to quantize to 256.
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = Math.round(data[i] * 255);
  gl.bindTexture(gl.TEXTURE_2D, cache.patternTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, PATTERN_SIZE, PATTERN_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  cache.patternKey = pattern;
  return cache.patternTex;
};

const thresholdMap = (input: any, options: ThresholdMapOptions = defaults) => {
  const {
    pattern = defaults.pattern,
    scale = defaults.scale,
    palette = defaults.palette,
  } = options;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      const patternTex = ensurePatternTex(gl, cache, pattern);
      if (patternTex) {
        resizeGLCanvas(canvas, W, H);
        const sourceTex = ensureTexture(gl, "thresholdMap:source", W, H);
        uploadSourceTexture(gl, sourceTex, input);

        drawPass(gl, null, W, H, cache.prog, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.prog.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, patternTex);
          gl.uniform1i(cache.prog.uniforms.u_pattern, 1);
          gl.uniform2f(cache.prog.uniforms.u_res, W, H);
          gl.uniform1f(cache.prog.uniforms.u_patternSize, PATTERN_SIZE);
          gl.uniform1f(cache.prog.uniforms.u_scale, scale);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const identity = paletteIsIdentity(palette);
          const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("Threshold Map", "WebGL2",
              `${pattern} scale=${scale}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }

  logFilterWasmStatus("Threshold Map", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const { data: patternData, w: pw } = generatePattern(pattern, PATTERN_SIZE);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;

      const pxm = Math.floor(x / scale) % pw;
      const pym = Math.floor(y / scale) % pw;
      const threshold = patternData[pym * pw + pxm];

      const on = lum > threshold;
      const value = on ? 255 : 0;

      const color = paletteGetColor(palette, rgba(value, value, value, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Threshold Map",
  func: thresholdMap,
  optionTypes,
  options: defaults,
  defaults
});
