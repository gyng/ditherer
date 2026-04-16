import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
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

const COLORMAP = { TOPOGRAPHIC: "TOPOGRAPHIC", BATHYMETRIC: "BATHYMETRIC", THERMAL: "THERMAL" };

const COLORMAPS: Record<string, number[][]> = {
  [COLORMAP.TOPOGRAPHIC]: [[0,100,0],[34,139,34],[144,238,144],[255,255,150],[210,180,80],[160,82,45],[139,90,43],[200,200,200],[255,255,255]],
  [COLORMAP.BATHYMETRIC]: [[0,0,80],[0,0,140],[0,50,180],[0,100,200],[50,150,220],[100,200,240],[180,230,250],[220,240,255],[245,250,255]],
  [COLORMAP.THERMAL]: [[0,0,50],[20,0,100],[80,0,140],[160,0,100],[220,60,20],[255,160,0],[255,220,50],[255,255,150],[255,255,255]]
};

const MAX_STOPS = 9;

const sampleGradient = (stops: number[][], t: number): [number, number, number] => {
  const ct = Math.max(0, Math.min(1, t));
  const pos = ct * (stops.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  if (idx >= stops.length - 1) return [stops[stops.length-1][0], stops[stops.length-1][1], stops[stops.length-1][2]];
  const a = stops[idx], b = stops[idx + 1];
  return [Math.round(a[0]+(b[0]-a[0])*frac), Math.round(a[1]+(b[1]-a[1])*frac), Math.round(a[2]+(b[2]-a[2])*frac)];
};

export const optionTypes = {
  bands: { type: RANGE, range: [3, 20], step: 1, default: 8, desc: "Number of elevation bands" },
  colormap: { type: ENUM, options: [
    { name: "Topographic", value: COLORMAP.TOPOGRAPHIC },
    { name: "Bathymetric", value: COLORMAP.BATHYMETRIC },
    { name: "Thermal", value: COLORMAP.THERMAL }
  ], default: COLORMAP.TOPOGRAPHIC, desc: "Color scheme for the contour bands" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bands: optionTypes.bands.default,
  colormap: optionTypes.colormap.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int   u_bands;
uniform int   u_stopCount;
uniform vec3  u_stops[${MAX_STOPS}];
uniform float u_levels;

vec3 sampleGradient(float t) {
  float ct = clamp(t, 0.0, 1.0);
  float pos = ct * float(u_stopCount - 1);
  int idx = int(floor(pos));
  float frac = pos - float(idx);
  if (idx >= u_stopCount - 1) {
    vec3 last = u_stops[0];
    for (int i = 0; i < ${MAX_STOPS}; i++) {
      if (i == u_stopCount - 1) last = u_stops[i];
    }
    return last;
  }
  vec3 a = u_stops[0];
  vec3 b = u_stops[1];
  for (int i = 0; i < ${MAX_STOPS}; i++) {
    if (i == idx) a = u_stops[i];
    if (i == idx + 1) b = u_stops[i];
  }
  return mix(a, b, frac);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float band = floor(lum * float(u_bands)) / float(u_bands);
  vec3 rgb = sampleGradient(band) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { cm: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cm: linkProgram(gl, CM_FS, [
      "u_source", "u_bands", "u_stopCount", "u_stops", "u_levels",
    ] as const),
  };
  return _cache;
};

const contourMap = (input: any, options = defaults) => {
  const { bands, colormap, palette } = options;
  const W = input.width, H = input.height;
  const stops = COLORMAPS[colormap] || COLORMAPS[COLORMAP.TOPOGRAPHIC];

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "contourMap:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const stopArr = new Float32Array(MAX_STOPS * 3);
      for (let i = 0; i < stops.length && i < MAX_STOPS; i++) {
        stopArr[i * 3] = stops[i][0];
        stopArr[i * 3 + 1] = stops[i][1];
        stopArr[i * 3 + 2] = stops[i][2];
      }

      drawPass(gl, null, W, H, cache.cm, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.cm.uniforms.u_source, 0);
        gl.uniform1i(cache.cm.uniforms.u_bands, bands);
        gl.uniform1i(cache.cm.uniforms.u_stopCount, Math.min(stops.length, MAX_STOPS));
        gl.uniform3fv(cache.cm.uniforms.u_stops, stopArr);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.cm.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Contour Map", "WebGL2",
            `${colormap} bands=${bands}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Contour Map", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      const band = Math.floor(lum * bands) / bands;
      const [cr, cg, cb] = sampleGradient(stops, band);
      const color = paletteGetColor(palette, rgba(cr, cg, cb, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Contour Map", func: contourMap, optionTypes, options: defaults, defaults });
