import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { resolvePaletteColorAlgorithm, logFilterBackend } from "utils";
import { RGB_NEAREST, RGB_APPROX } from "constants/color";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { applyPalettePassToCanvas, applyLinearPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

const MAX_GL_PALETTE = 64;

// GL path for user palette with RGB / RGB_APPROX distance — brute-force
// nearest-colour search over ≤64 palette entries per pixel, fully parallel.
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
  _linearize?: boolean;
  palette?: typeof defaults.palette & {
    options?: QuantizePaletteOptions;
  };
};

const quantize = (input: any, options: QuantizeOptions = defaults) => {
  const { palette } = options;
  const W = input.width, H = input.height;
  const algo = resolvePaletteColorAlgorithm(palette);
  const paletteOpts = palette.options as { colors?: number[][]; levels?: number } | undefined;
  const colors = paletteOpts?.colors;

  // GL in-shader path: user palette with RGB / RGB_APPROX distance, ≤64 colours.
  const glInShader =
    Array.isArray(colors) && colors.length > 0 && colors.length <= MAX_GL_PALETTE
    && (algo === RGB_NEAREST || algo === RGB_APPROX);
  if (glInShader && colors) {
    const ctx = getGLCtx();
    if (!ctx) return input;
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
    if (!rendered) return input;
    logFilterBackend("Quantize", "WebGL2",
      `algo=${algo} colors=${colors.length}${options._linearize ? " linearized" : ""}`);
    return rendered;
  }

  // Everything else (LEVELS palette, HSV_NEAREST, LAB_NEAREST, >64 colours)
  // goes through the shared CPU palette-pass primitive. paletteIsIdentity
  // returns true for the levels≥256 default; leave the canvas untouched then.
  if (paletteIsIdentity(palette)) {
    logFilterBackend("Quantize", "WebGL2", "identity palette");
    return input;
  }
  const out = options._linearize
    ? applyLinearPalettePassToCanvas(input, W, H, palette)
    : applyPalettePassToCanvas(input, W, H, palette);
  logFilterBackend("Quantize", "WebGL2",
    `palettePass${options._linearize ? " linear" : ""}${algo ? ` algo=${algo}` : ""}`);
  return out ?? input;
};

export default defineFilter<QuantizeOptions>({
  name: "Quantize",
  func: quantize,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
