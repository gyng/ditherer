import { BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
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

export const optionTypes = {
  perChannel: { type: BOOL, default: false, desc: "Equalize each RGB channel independently" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  perChannel: optionTypes.perChannel.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const buildCdf = (hist: Uint32Array, total: number): Uint8Array => {
  const cdf = new Uint8Array(256);
  let cumulative = 0;
  let cdfMin = -1;
  const raw = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    cumulative += hist[i];
    raw[i] = cumulative;
    if (cdfMin < 0 && cumulative > 0) cdfMin = cumulative;
  }
  const range = total - cdfMin;
  for (let i = 0; i < 256; i += 1) {
    cdf[i] = range > 0 ? Math.round(((raw[i] - cdfMin) / range) * 255) : 0;
  }
  return cdf;
};

const HEQ_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_lut;      // 256×1 RGBA8 CDF (R,G,B channels filled)
uniform int u_perChannel;
uniform float u_levels;

vec3 lutLookup(vec3 v) {
  int ir = int(clamp(floor(v.r * 255.0 + 0.5), 0.0, 255.0));
  int ig = int(clamp(floor(v.g * 255.0 + 0.5), 0.0, 255.0));
  int ib = int(clamp(floor(v.b * 255.0 + 0.5), 0.0, 255.0));
  return vec3(
    texelFetch(u_lut, ivec2(ir, 0), 0).r,
    texelFetch(u_lut, ivec2(ig, 0), 0).g,
    texelFetch(u_lut, ivec2(ib, 0), 0).b
  );
}

float lumaLut(float v) {
  int idx = int(clamp(floor(v * 255.0 + 0.5), 0.0, 255.0));
  return texelFetch(u_lut, ivec2(idx, 0), 0).r;
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb;
  if (u_perChannel == 1) {
    rgb = lutLookup(c.rgb);
  } else {
    float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    float mapped = lumaLut(lum);
    float scale = lum > 1.0 / 255.0 ? mapped / lum : 1.0;
    rgb = clamp(c.rgb * scale, 0.0, 1.0);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type GLCache = { prog: Program; lutTex: WebGLTexture | null };
let _glCache: GLCache | null = null;

const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    prog: linkProgram(gl, HEQ_FS, ["u_source", "u_lut", "u_perChannel", "u_levels"] as const),
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

const histogramEqualization = (input: any, options: typeof defaults = defaults) => {
  const { perChannel, palette } = options;
  const W = input.width;
  const H = input.height;
  const total = W * H;

  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  let mapR: Uint8Array, mapG: Uint8Array, mapB: Uint8Array;
  if (perChannel) {
    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    for (let i = 0; i < buf.length; i += 4) {
      histR[buf[i]] += 1;
      histG[buf[i + 1]] += 1;
      histB[buf[i + 2]] += 1;
    }
    mapR = buildCdf(histR, total);
    mapG = buildCdf(histG, total);
    mapB = buildCdf(histB, total);
  } else {
    const histL = new Uint32Array(256);
    for (let i = 0; i < buf.length; i += 4) {
      const lum = Math.round(buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722);
      histL[lum] += 1;
    }
    const cdfL = buildCdf(histL, total);
    mapR = mapG = mapB = cdfL;
  }

  const lutRGBA = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    lutRGBA[i * 4]     = mapR[i];
    lutRGBA[i * 4 + 1] = mapG[i];
    lutRGBA[i * 4 + 2] = mapB[i];
    lutRGBA[i * 4 + 3] = 255;
  }

  const ctx = getGLCtx();
  if (!ctx) return input;
  const { gl, canvas } = ctx;
  const cache = initGLCache(gl);
  const vao = getQuadVAO(gl);
  const lutTex = ensureLutTex(gl, cache);
  if (!lutTex) return input;

  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "histEq:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutRGBA);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const identity = paletteIsIdentity(palette);
  drawPass(gl, null, W, H, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.uniform1i(cache.prog.uniforms.u_lut, 1);
    gl.uniform1i(cache.prog.uniforms.u_perChannel, perChannel ? 1 : 0);
    const pOpts = (palette as { options?: { levels?: number } }).options;
    gl.uniform1f(cache.prog.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Histogram equalization", "WebGL2",
    `${perChannel ? "perChannel" : "luma"}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Histogram equalization",
  func: histogramEqualization,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
