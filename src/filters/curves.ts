import { ENUM, CURVE, PALETTE } from "constants/controlTypes";
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

const CHANNEL = {
  RGB: "RGB",
  R: "R",
  G: "G",
  B: "B",
  LUMA: "LUMA"
};

const CHANNEL_ID: Record<string, number> = { RGB: 0, R: 1, G: 2, B: 3, LUMA: 4 };

const DEFAULT_POINTS = JSON.stringify([
  [0, 0],
  [255, 255]
]);

const parsePoints = (value: string): [number, number][] => {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [[0, 0], [255, 255]];

    const normalized = parsed
      .filter((entry) => Array.isArray(entry) && entry.length >= 2)
      .map((entry) => {
        const rawX = Number(entry[0]);
        const rawY = Number(entry[1]);
        const x = rawX <= 1 && rawY <= 1 ? rawX * 255 : rawX;
        const y = rawX <= 1 && rawY <= 1 ? rawY * 255 : rawY;
        return [
          Math.max(0, Math.min(255, Math.round(x))),
          Math.max(0, Math.min(255, Math.round(y)))
        ] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);

    if (normalized.length < 2) return [[0, 0], [255, 255]];
    if (normalized[0][0] !== 0) normalized.unshift([0, normalized[0][1]]);
    if (normalized[normalized.length - 1][0] !== 255) normalized.push([255, normalized[normalized.length - 1][1]]);
    return normalized;
  } catch {
    return [[0, 0], [255, 255]];
  }
};

const buildCurveLut = (points: [number, number][]) => {
  const lut = new Uint8Array(256);
  let seg = 0;

  for (let x = 0; x < 256; x++) {
    while (seg < points.length - 2 && x > points[seg + 1][0]) seg++;
    const [x0, y0] = points[seg];
    const [x1, y1] = points[Math.min(seg + 1, points.length - 1)];
    const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    lut[x] = Math.max(0, Math.min(255, Math.round(y0 + (y1 - y0) * t)));
  }

  return lut;
};

export const optionTypes = {
  channel: {
    type: ENUM,
    options: [
      { name: "RGB", value: CHANNEL.RGB },
      { name: "Red", value: CHANNEL.R },
      { name: "Green", value: CHANNEL.G },
      { name: "Blue", value: CHANNEL.B },
      { name: "Luma", value: CHANNEL.LUMA }
    ],
    default: CHANNEL.RGB,
    desc: "Which channel is remapped by the curve"
  },
  points: {
    type: CURVE,
    default: DEFAULT_POINTS,
    desc: "Tone curve editor. Points are still stored as JSON pairs for saved chains and URLs."
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  channel: optionTypes.channel.default,
  points: optionTypes.points.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// 256×1 R8 LUT texture is sampled via texelFetch — one lookup per channel.
const CURVES_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_lut;     // 256×1 R8 LUT
uniform int   u_channel;     // 0 RGB, 1 R, 2 G, 3 B, 4 LUMA
uniform float u_levels;

float lutSample(float v) {
  int idx = int(clamp(floor(v * 255.0 + 0.5), 0.0, 255.0));
  return texelFetch(u_lut, ivec2(idx, 0), 0).r;
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb = c.rgb;

  if (u_channel == 0) {
    rgb = vec3(lutSample(rgb.r), lutSample(rgb.g), lutSample(rgb.b));
  } else if (u_channel == 1) {
    rgb.r = lutSample(rgb.r);
  } else if (u_channel == 2) {
    rgb.g = lutSample(rgb.g);
  } else if (u_channel == 3) {
    rgb.b = lutSample(rgb.b);
  } else {
    // LUMA mode: build scale = mappedLum/lum and apply uniformly.
    float lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    float mapped = lutSample(lum);
    float scale = lum < 1.0 / 255.0 ? mapped : mapped / lum;
    rgb = clamp(rgb * scale, 0.0, 1.0);
  }

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { cv: Program };
let _cache: Cache | null = null;
let _lutTex: WebGLTexture | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cv: linkProgram(gl, CURVES_FS, [
      "u_source", "u_lut", "u_channel", "u_levels",
    ] as const),
  };
  return _cache;
};

const ensureLutTex = (gl: WebGL2RenderingContext): WebGLTexture | null => {
  if (_lutTex) return _lutTex;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  _lutTex = tex;
  return tex;
};

const uploadLut = (gl: WebGL2RenderingContext, tex: WebGLTexture, lut: Uint8Array) => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, lut);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
};

const curves = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { channel, points, palette } = options;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const W = input.width;
  const H = input.height;
  const lut = buildCurveLut(parsePoints(points));

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      const lutTex = ensureLutTex(gl);
      if (lutTex) {
        uploadLut(gl, lutTex, lut);
        resizeGLCanvas(canvas, W, H);
        const sourceTex = ensureTexture(gl, "curves:source", W, H);
        uploadSourceTexture(gl, sourceTex, input);

        drawPass(gl, null, W, H, cache.cv, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.cv.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, lutTex);
          gl.uniform1i(cache.cv.uniforms.u_lut, 1);
          gl.uniform1i(cache.cv.uniforms.u_channel, CHANNEL_ID[channel] ?? 0);
          const identity = paletteIsIdentityShared(palette);
          const pOpts2 = (palette as { options?: { levels?: number } }).options;
          gl.uniform1f(cache.cv.uniforms.u_levels, identity ? (pOpts2?.levels ?? 256) : 256);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const identity = paletteIsIdentityShared(palette);
          const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("Curves", "WebGL2",
              `channel=${channel}${identity ? "" : " +palettePass"}`);
            return out;
          }
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
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;
  const perChannel = channel === CHANNEL.RGB || channel === CHANNEL.R || channel === CHANNEL.G || channel === CHANNEL.B;
  const canUseWasm = perChannel && wasmIsLoaded() && options._wasmAcceleration !== false;

  if (canUseWasm) {
    const identity = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) identity[i] = i;
    const lutU8 = lut instanceof Uint8Array ? lut : new Uint8Array(lut);
    const lutR = channel === CHANNEL.RGB || channel === CHANNEL.R ? lutU8 : identity;
    const lutG = channel === CHANNEL.RGB || channel === CHANNEL.G ? lutU8 : identity;
    const lutB = channel === CHANNEL.RGB || channel === CHANNEL.B ? lutU8 : identity;
    wasmApplyChannelLut(buf, outBuf, lutR, lutG, lutB);

    if (!paletteIsIdentity) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = getBufferIndex(x, y, W);
          const color = srgbPaletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
        }
      }
    }
    logFilterWasmStatus("Curves", true, `channel=${channel}${paletteIsIdentity ? "" : " +palettePass"}`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  logFilterWasmStatus("Curves", false, channel === CHANNEL.LUMA ? "channel=LUMA" : (options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet"));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i];
      let g = buf[i + 1];
      let b = buf[i + 2];

      if (channel === CHANNEL.RGB) {
        r = lut[r];
        g = lut[g];
        b = lut[b];
      } else if (channel === CHANNEL.R) {
        r = lut[r];
      } else if (channel === CHANNEL.G) {
        g = lut[g];
      } else if (channel === CHANNEL.B) {
        b = lut[b];
      } else {
        const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const mappedLum = lut[lum];
        const scale = lum === 0 ? mappedLum / 255 : mappedLum / lum;
        r = Math.max(0, Math.min(255, Math.round(r * scale)));
        g = Math.max(0, Math.min(255, Math.round(g * scale)));
        b = Math.max(0, Math.min(255, Math.round(b * scale)));
      }

      const color = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Curves",
  func: curves,
  optionTypes,
  options: defaults,
  defaults
});
