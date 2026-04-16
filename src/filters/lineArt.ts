import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
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
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";
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

export const optionTypes = {
  threshold: { type: RANGE, range: [5, 100], step: 1, default: 30, desc: "Edge detection sensitivity" },
  lineWidth: { type: RANGE, range: [0.1, 5], step: 0.1, default: 1, desc: "Drawn line thickness" },
  cleanupRadius: { type: RANGE, range: [0, 3], step: 1, default: 1, desc: "Remove isolated noise pixels" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Ink/line color" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  cleanupRadius: optionTypes.cleanupRadius.default,
  lineColor: optionTypes.lineColor.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

// Pass 1: Sobel on luminance → threshold → dilate to a R8 edge mask.
const LA_DILATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;
uniform int   u_ceilR;
uniform float u_reach;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

bool isEdge(float x, float y) {
  float a = lum(samplePx(x - 1.0, y - 1.0));
  float b = lum(samplePx(x,       y - 1.0));
  float c = lum(samplePx(x + 1.0, y - 1.0));
  float d = lum(samplePx(x - 1.0, y      ));
  float f = lum(samplePx(x + 1.0, y      ));
  float g = lum(samplePx(x - 1.0, y + 1.0));
  float h = lum(samplePx(x,       y + 1.0));
  float iv = lum(samplePx(x + 1.0, y + 1.0));
  float gx = (c + 2.0 * f + iv) - (a + 2.0 * d + g);
  float gy = (g + 2.0 * h + iv) - (a + 2.0 * b + c);
  float mag = sqrt(gx * gx + gy * gy) * 255.0;
  return mag > u_threshold;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  bool lit = false;
  for (int ky = -4; ky <= 4; ky++) {
    if (ky < -u_ceilR || ky > u_ceilR) continue;
    for (int kx = -4; kx <= 4; kx++) {
      if (kx < -u_ceilR || kx > u_ceilR) continue;
      if (sqrt(float(kx * kx + ky * ky)) > u_reach) continue;
      if (isEdge(x + float(kx), y + float(ky))) { lit = true; break; }
    }
    if (lit) break;
  }
  fragColor = vec4(lit ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}
`;

// Pass 2: cleanup (require ≥2 neighbours in the dilated mask) + colour.
const LA_RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_edges;
uniform vec2  u_res;
uniform int   u_cleanupR;
uniform vec3  u_lineColor;
uniform vec3  u_bgColor;

float sampleEdge(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texelFetch(u_edges, ivec2(int(cx), int(cy)), 0).r;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  float self = sampleEdge(x, y);

  bool isLine;
  if (self < 0.5) {
    isLine = false;
  } else if (u_cleanupR <= 0) {
    isLine = true;
  } else {
    int neighbors = 0;
    for (int ky = -3; ky <= 3; ky++) {
      if (ky < -u_cleanupR || ky > u_cleanupR) continue;
      for (int kx = -3; kx <= 3; kx++) {
        if (kx < -u_cleanupR || kx > u_cleanupR) continue;
        if (kx == 0 && ky == 0) continue;
        if (sampleEdge(x + float(kx), y + float(ky)) > 0.5) neighbors++;
      }
    }
    isLine = neighbors >= 2;
  }
  vec3 rgb = isLine ? u_lineColor : u_bgColor;
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { dilate: Program; render: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    dilate: linkProgram(gl, LA_DILATE_FS, ["u_source", "u_res", "u_threshold", "u_ceilR", "u_reach"] as const),
    render: linkProgram(gl, LA_RENDER_FS, ["u_edges", "u_res", "u_cleanupR", "u_lineColor", "u_bgColor"] as const),
  };
  return _cache;
};

const lineArt = (input: any, options = defaults) => {
  const { threshold, lineWidth, cleanupRadius, lineColor, bgColor, palette } = options;
  const W = input.width, H = input.height;
  const effectiveThreshold = lineWidth < 1 ? threshold / Math.max(0.1, lineWidth) : threshold;
  const r = Math.max(0, lineWidth - 1);
  const ceilR = Math.ceil(r);
  const reach = r + 0.35;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "lineArt:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      // Dilated edges into a pooled RGBA8 target (R channel holds the mask).
      const edgesTex = ensureTexture(gl, "lineArt:edges", W, H);

      drawPass(gl, edgesTex, W, H, cache.dilate, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.dilate.uniforms.u_source, 0);
        gl.uniform2f(cache.dilate.uniforms.u_res, W, H);
        gl.uniform1f(cache.dilate.uniforms.u_threshold, effectiveThreshold);
        gl.uniform1i(cache.dilate.uniforms.u_ceilR, Math.min(4, ceilR));
        gl.uniform1f(cache.dilate.uniforms.u_reach, reach);
      }, vao);

      drawPass(gl, null, W, H, cache.render, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, edgesTex.tex);
        gl.uniform1i(cache.render.uniforms.u_edges, 0);
        gl.uniform2f(cache.render.uniforms.u_res, W, H);
        gl.uniform1i(cache.render.uniforms.u_cleanupR, Math.min(3, Math.max(0, Math.round(cleanupRadius))));
        gl.uniform3f(cache.render.uniforms.u_lineColor, lineColor[0] / 255, lineColor[1] / 255, lineColor[2] / 255);
        gl.uniform3f(cache.render.uniforms.u_bgColor, bgColor[0] / 255, bgColor[1] / 255, bgColor[2] / 255);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Line Art", "WebGL2",
            `w=${lineWidth} t=${threshold}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Line Art", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const lum = computeLuminance(buf, W, H);
  const { magnitude } = sobelEdges(lum, W, H);
  const edges = new Uint8Array(W * H);
  for (let i = 0; i < magnitude.length; i++) {
    edges[i] = magnitude[i] > effectiveThreshold ? 1 : 0;
  }

  let finalEdges = edges;
  if (lineWidth > 1) {
    finalEdges = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let found = false;
        for (let ky = -ceilR; ky <= ceilR && !found; ky++)
          for (let kx = -ceilR; kx <= ceilR && !found; kx++) {
            if (Math.hypot(kx, ky) > reach) continue;
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            if (edges[ny * W + nx]) found = true;
          }
        finalEdges[y * W + x] = found ? 1 : 0;
      }
  }

  if (cleanupRadius > 0) {
    const cleaned = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!finalEdges[y * W + x]) continue;
        let neighbors = 0;
        for (let ky = -cleanupRadius; ky <= cleanupRadius; ky++)
          for (let kx = -cleanupRadius; kx <= cleanupRadius; kx++) {
            if (kx === 0 && ky === 0) continue;
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            neighbors += finalEdges[ny * W + nx];
          }
        cleaned[y * W + x] = neighbors >= 2 ? 1 : 0;
      }
    finalEdges = cleaned;
  }

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const isEdge = finalEdges[y * W + x] === 1;
      const c = isEdge ? lineColor : bgColor;
      const color = paletteGetColor(palette, rgba(c[0], c[1], c[2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Line Art", func: lineArt, optionTypes, options: defaults, defaults });
