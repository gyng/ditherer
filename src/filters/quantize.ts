import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  srgbPaletteGetColor,
  linearPaletteGetColor,
  wasmQuantizeBuffer,
  wasmApplyChannelLut,
  wasmIsLoaded,
  resolvePaletteColorAlgorithm,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { RGB_NEAREST, RGB_APPROX } from "constants/color";
import { defineFilter, type FilterOptionValues } from "filters/types";
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

const MAX_GL_PALETTE = 64;

// GL path handles the case the WASM primitive can't: linearize + user palette
// with RGB / RGB_APPROX distance. Brute-force nearest-colour search over
// ≤64 palette entries per pixel, fully parallel across the image.
const QUANTIZE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int   u_algo;          // 0 RGB_NEAREST, 1 RGB_APPROX
uniform int   u_linearize;
uniform int   u_count;
uniform vec3  u_palette[${MAX_GL_PALETTE}];    // sRGB 0..1
uniform vec3  u_paletteLin[${MAX_GL_PALETTE}]; // linearised 0..1

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 query = u_linearize == 1 ? srgbToLinear(src.rgb) : src.rgb;

  int best = 0;
  float bestD = 1e20;
  for (int i = 0; i < ${MAX_GL_PALETTE}; i++) {
    if (i >= u_count) break;
    vec3 p = u_linearize == 1 ? u_paletteLin[i] : u_palette[i];
    vec3 d = query - p;
    float dist;
    if (u_algo == 1) {
      // RGB_APPROX: redmean weighting in 0..255 space.
      vec3 q255 = query * 255.0;
      vec3 p255 = (u_linearize == 1 ? u_paletteLin[i] : u_palette[i]) * 255.0;
      float rm = (q255.r + p255.r) * 0.5;
      vec3 d255 = q255 - p255;
      dist = (2.0 + rm / 256.0) * d255.r * d255.r
           + 4.0 * d255.g * d255.g
           + (2.0 + (255.0 - rm) / 256.0) * d255.b * d255.b;
    } else {
      dist = dot(d, d);
    }
    if (dist < bestD) { bestD = dist; best = i; }
  }

  // Pull the matched colour out — GLSL ES 3.00 allows dynamic indexing but
  // a safety loop keeps some drivers happy.
  vec3 picked = u_palette[0];
  for (int i = 0; i < ${MAX_GL_PALETTE}; i++) {
    if (i == best) picked = u_palette[i];
  }
  fragColor = vec4(picked, src.a);
}
`;

type GLCache = { q: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    q: linkProgram(gl, QUANTIZE_FS, [
      "u_source", "u_algo", "u_linearize", "u_count",
      "u_palette", "u_paletteLin",
    ] as const),
  };
  return _glCache;
};

const sRGBToLinearScalar = (v: number): number => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

// For the nearest-levels palette, each output channel is `round(round(x/step)*step)`
// — depends only on the input byte, so we can collapse it into a 256-entry LUT
// and apply with the generic WASM LUT primitive.
const buildLevelsLut = (levels: number): Uint8Array => {
  const lut = new Uint8Array(256);
  if (levels >= 256) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  const step = 255 / (levels - 1);
  for (let i = 0; i < 256; i += 1) {
    const v = Math.round(Math.round(i / step) * step);
    lut[i] = Math.max(0, Math.min(255, v));
  }
  return lut;
};

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

const defaults = {
  palette: { ...optionTypes.palette.default, options: { levels: 7 } }
};

type QuantizePaletteOptions = {
  levels?: number;
  colorDistanceAlgorithm?: string;
  colors?: number[][];
};

type QuantizeOptions = FilterOptionValues & typeof defaults & {
  _wasmAcceleration?: boolean;
  _webglAcceleration?: boolean;
  _linearize?: boolean;
  palette?: typeof defaults.palette & {
    options?: QuantizePaletteOptions;
  };
};

const quantize = (
  input: any,
  options: QuantizeOptions = defaults
) => {
  const { palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const algo = resolvePaletteColorAlgorithm(palette);
  const paletteOpts = palette.options as { colors?: number[][]; levels?: number } | undefined;
  const colors = paletteOpts?.colors;
  const W = input.width, H = input.height;

  // GL path: nearest-colour over a user palette with RGB / RGB_APPROX
  // distance, ≤64 colours. Covers the linearize+user-palette case the
  // WASM primitive skips.
  const glEligible =
    glAvailable()
    && options._webglAcceleration !== false
    && Array.isArray(colors) && colors.length > 0 && colors.length <= MAX_GL_PALETTE
    && (algo === RGB_NEAREST || algo === RGB_APPROX);
  if (glEligible && colors) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initGLCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "quantize:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const palArr = new Float32Array(MAX_GL_PALETTE * 3);
      const palLin = new Float32Array(MAX_GL_PALETTE * 3);
      for (let i = 0; i < colors.length; i++) {
        const c = colors[i];
        palArr[i * 3] = (c[0] ?? 0) / 255;
        palArr[i * 3 + 1] = (c[1] ?? 0) / 255;
        palArr[i * 3 + 2] = (c[2] ?? 0) / 255;
        palLin[i * 3] = sRGBToLinearScalar(c[0] ?? 0);
        palLin[i * 3 + 1] = sRGBToLinearScalar(c[1] ?? 0);
        palLin[i * 3 + 2] = sRGBToLinearScalar(c[2] ?? 0);
      }

      drawPass(gl, null, W, H, cache.q, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.q.uniforms.u_source, 0);
        gl.uniform1i(cache.q.uniforms.u_algo, algo === RGB_APPROX ? 1 : 0);
        gl.uniform1i(cache.q.uniforms.u_linearize, options._linearize ? 1 : 0);
        gl.uniform1i(cache.q.uniforms.u_count, colors.length);
        gl.uniform3fv(cache.q.uniforms.u_palette, palArr);
        gl.uniform3fv(cache.q.uniforms.u_paletteLin, palLin);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        logFilterBackend("Quantize", "WebGL2",
          `algo=${algo} colors=${colors.length}${options._linearize ? " linearized" : ""}`);
        return rendered;
      }
    }
  }

  // WASM buffer quantize — single call replaces entire pixel loop.
  let wasmReason = "";
  if (!options._wasmAcceleration) wasmReason = "_wasmAcceleration off";
  else if (!wasmIsLoaded()) wasmReason = "wasm not loaded yet";
  // Linearize is fine for levels — the linear→sRGB→snap→linear→sRGB
  // pipeline reduces to a pure u8-domain levels snap (input and output are
  // both sRGB u8; our LUT-based roundtrips are identity at u8 precision). For
  // user palette + linearize, the linear-space distance still matters, so
  // fall through to the JS loop there.
  else if (options._linearize && colors) wasmReason = "linearize on (user palette)";

  if (!wasmReason) {
    // User palette (has colors + algorithm) → full quantize dispatcher.
    if (colors && algo) {
      const result = wasmQuantizeBuffer(buf, colors, algo);
      if (result && result.length === buf.length) {
        buf.set(result);
        logFilterWasmStatus("Quantize", true, `algo=${algo}`);
        outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
        return output;
      }
      wasmReason = "wasm returned null";
    } else if (typeof paletteOpts?.levels === "number") {
      // Nearest / levels palette: round-round-snap per channel fits a 256 LUT.
      const lut = buildLevelsLut(paletteOpts.levels);
      wasmApplyChannelLut(buf, buf, lut, lut, lut);
      logFilterWasmStatus("Quantize", true, `levels=${paletteOpts.levels}${options._linearize ? " (linear)" : ""}`);
      outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
      return output;
    } else {
      wasmReason = "palette unsupported";
    }
  }
  logFilterWasmStatus("Quantize", false, wasmReason);

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = [floatBuf[i], floatBuf[i + 1], floatBuf[i + 2], floatBuf[i + 3]];
        const color = linearPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(floatBuf, i, color[0], color[1], color[2], floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        const color = srgbPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter<QuantizeOptions>({
  name: "Quantize",
  func: quantize,
  options: defaults,
  optionTypes,
  defaults
});
