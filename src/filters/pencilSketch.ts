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
  strokeDensity: { type: RANGE, range: [1, 10], step: 1, default: 4, desc: "Hatching line density" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.1, default: 1.5, desc: "Contrast boost for pencil strokes" },
  pencilColor: { type: COLOR, default: [30, 25, 20], desc: "Pencil graphite color" },
  paperColor: { type: COLOR, default: [250, 245, 235], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strokeDensity: optionTypes.strokeDensity.default,
  contrast: optionTypes.contrast.default,
  pencilColor: optionTypes.pencilColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Shader computes luminance + Sobel (magnitude + direction) inline, then
// projects each pixel onto the edge-perpendicular axis to build flow-aligned
// hatching. Single pass.
const PS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strokeDensity;
uniform float u_contrast;
uniform vec3  u_pencilColor;  // 0..1
uniform vec3  u_paperColor;   // 0..1
uniform float u_levels;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Normalised luminance at the centre pixel.
  float l = lum(samplePx(x, y));

  // Sobel on normalised luminance.
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
  // utils/edges returns magnitude scaled by 255 — match that scale so the
  // /100 edgeFactor in the JS path maps 1:1.
  float mag = sqrt(gx * gx + gy * gy) * 255.0;
  float dir = atan(gy, gx);

  float darkness = clamp((1.0 - l) * u_contrast, 0.0, 1.0);

  float perpDir = dir + 1.5707963;
  float proj = x * cos(perpDir) + y * sin(perpDir);
  float linePos = mod(proj, u_strokeDensity);
  if (linePos < 0.0) linePos += u_strokeDensity;
  bool onStroke = linePos < u_strokeDensity * 0.4;

  float edgeFactor = clamp(mag / 100.0, 0.0, 1.0);
  float strokeIntensity = onStroke
    ? darkness * (0.3 + edgeFactor * 0.7)
    : darkness * 0.15;

  vec3 rgb = mix(u_paperColor, u_pencilColor, strokeIntensity);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { ps: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ps: linkProgram(gl, PS_FS, [
      "u_source", "u_res", "u_strokeDensity", "u_contrast",
      "u_pencilColor", "u_paperColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const pencilSketch = (input: any, options = defaults) => {
  const { strokeDensity, contrast, pencilColor, paperColor, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "pencilSketch:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ps, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ps.uniforms.u_source, 0);
        gl.uniform2f(cache.ps.uniforms.u_res, W, H);
        gl.uniform1f(cache.ps.uniforms.u_strokeDensity, strokeDensity);
        gl.uniform1f(cache.ps.uniforms.u_contrast, contrast);
        gl.uniform3f(cache.ps.uniforms.u_pencilColor, pencilColor[0] / 255, pencilColor[1] / 255, pencilColor[2] / 255);
        gl.uniform3f(cache.ps.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.ps.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Pencil Sketch", "WebGL2",
            `density=${strokeDensity}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Pencil Sketch", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const lum = computeLuminance(buf, W, H);
  for (let i = 0; i < lum.length; i++) lum[i] /= 255;

  const { magnitude, direction } = sobelEdges(lum, W, H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const l = lum[y * W + x];
      const edge = magnitude[y * W + x];
      const dir = direction[y * W + x];

      let darkness = (1 - l) * contrast;
      darkness = Math.max(0, Math.min(1, darkness));

      const perpDir = dir + Math.PI / 2;
      const proj = x * Math.cos(perpDir) + y * Math.sin(perpDir);
      const linePos = ((proj % strokeDensity) + strokeDensity) % strokeDensity;
      const onStroke = linePos < strokeDensity * 0.4;

      const edgeFactor = Math.min(1, edge / 100);
      const strokeIntensity = onStroke ? darkness * (0.3 + edgeFactor * 0.7) : darkness * 0.15;

      const r = Math.round(paperColor[0] + (pencilColor[0] - paperColor[0]) * strokeIntensity);
      const g = Math.round(paperColor[1] + (pencilColor[1] - paperColor[1]) * strokeIntensity);
      const b = Math.round(paperColor[2] + (pencilColor[2] - paperColor[2]) * strokeIntensity);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Pencil Sketch", func: pencilSketch, optionTypes, options: defaults, defaults });
