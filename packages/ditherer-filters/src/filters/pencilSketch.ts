import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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
} from "../gl/index";

export const optionTypes = {
  strokeDensity: { type: RANGE, range: [1, 10], step: 1, default: 4, desc: "Hatching line density — higher values draw more closely spaced strokes" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.1, default: 1.5, desc: "Contrast boost for pencil strokes" },
  pencilColor: { type: COLOR, default: [30, 25, 20], desc: "Pencil graphite color" },
  paperColor: { type: COLOR, default: [250, 245, 235], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
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
uniform float u_strokeSpacing;
uniform float u_contrast;
uniform vec3  u_pencilColor;  // 0..1
uniform vec3  u_paperColor;   // 0..1

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv);
}

float edgeSignal(vec4 sampleValue) {
  return sampleValue.a * (0.25 + 0.75 * lum(sampleValue.rgb));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Normalised luminance at the centre pixel.
  vec4 source = samplePx(x, y);
  float l = source.a > (0.5 / 255.0) ? lum(source.rgb) : 1.0;

  // Sobel on normalised luminance.
  float a = edgeSignal(samplePx(x - 1.0, y - 1.0));
  float b = edgeSignal(samplePx(x,       y - 1.0));
  float c = edgeSignal(samplePx(x + 1.0, y - 1.0));
  float d = edgeSignal(samplePx(x - 1.0, y      ));
  float f = edgeSignal(samplePx(x + 1.0, y      ));
  float g = edgeSignal(samplePx(x - 1.0, y + 1.0));
  float h = edgeSignal(samplePx(x,       y + 1.0));
  float iv = edgeSignal(samplePx(x + 1.0, y + 1.0));
  float gx = (c + 2.0 * f + iv) - (a + 2.0 * d + g);
  float gy = (g + 2.0 * h + iv) - (a + 2.0 * b + c);
  float rawMag = sqrt(gx * gx + gy * gy);
  float mag = rawMag * 255.0;
  float dir = rawMag > 1e-6 ? atan(gy, gx) : 0.0;

  float darkness = clamp((1.0 - l) * u_contrast, 0.0, 1.0);

  // The Sobel direction is the contour normal, so using it as the stripe
  // normal makes each stroke tangent follow the local contour.
  float proj = x * cos(dir) + y * sin(dir);
  float linePos = mod(proj, u_strokeSpacing);
  if (linePos < 0.0) linePos += u_strokeSpacing;
  float lineCoverage = 0.5 + 0.5 * cos(6.2831853 * linePos / u_strokeSpacing);

  float edgeFactor = clamp(mag / 100.0, 0.0, 1.0);
  float strokeIntensity = darkness * mix(0.15, 0.3 + edgeFactor * 0.7, lineCoverage);

  vec3 rgb = mix(u_paperColor, u_pencilColor, strokeIntensity);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), source.a);
}
`;

type Cache = { ps: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ps: linkProgram(gl, PS_FS, [
      "u_source", "u_res", "u_strokeSpacing", "u_contrast",
      "u_pencilColor", "u_paperColor",
    ] as const),
  };
  return _cache;
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const validColor = (value: unknown, fallback: number[]): number[] => (
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(channel => typeof channel === "number" && Number.isFinite(channel))
    ? value.slice(0, 3).map(channel => Math.max(0, Math.min(255, channel as number)))
    : fallback
);

const pencilSketch = (input: any, options: Partial<typeof defaults> & { _webglAcceleration?: boolean } = defaults) => {
  const strokeDensity = finite(options.strokeDensity, defaults.strokeDensity, 1, 10);
  // This maps the complete saved-state range to 1/8..1/2 cycles per pixel,
  // preserving the old default spacing while staying at or below Nyquist.
  const strokeSpacing = 24 / (strokeDensity + 2);
  const contrast = finite(options.contrast, defaults.contrast, 0.5, 3);
  const pencilColor = validColor(options.pencilColor, defaults.pencilColor);
  const paperColor = validColor(options.paperColor, defaults.paperColor);
  const palette = options.palette ?? defaults.palette;
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
        gl.uniform1f(cache.ps.uniforms.u_strokeSpacing, strokeSpacing);
        gl.uniform1f(cache.ps.uniforms.u_contrast, contrast);
        gl.uniform3f(cache.ps.uniforms.u_pencilColor, pencilColor[0] / 255, pencilColor[1] / 255, pencilColor[2] / 255);
        gl.uniform3f(cache.ps.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
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

  const tone = new Float32Array(W * H);
  const signal = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const pixel = y * W + x;
      const alpha = buf[i + 3] / 255;
      const luminance = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      tone[pixel] = alpha > 0.5 / 255 ? luminance : 1;
      signal[pixel] = alpha * (0.25 + 0.75 * luminance) * 255;
    }
  }

  const sampleSignal = (x: number, y: number) => signal[
    Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))
  ];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const pixel = y * W + x;
      const l = tone[pixel];
      const a = sampleSignal(x - 1, y - 1);
      const top = sampleSignal(x, y - 1);
      const topRight = sampleSignal(x + 1, y - 1);
      const left = sampleSignal(x - 1, y);
      const right = sampleSignal(x + 1, y);
      const bottomLeft = sampleSignal(x - 1, y + 1);
      const bottom = sampleSignal(x, y + 1);
      const bottomRight = sampleSignal(x + 1, y + 1);
      const gx = topRight + 2 * right + bottomRight - a - 2 * left - bottomLeft;
      const gy = bottomLeft + 2 * bottom + bottomRight - a - 2 * top - topRight;
      const edge = Math.hypot(gx, gy);
      const dir = edge > 1e-4 ? Math.atan2(gy, gx) : 0;

      let darkness = (1 - l) * contrast;
      darkness = Math.max(0, Math.min(1, darkness));

      const proj = x * Math.cos(dir) + y * Math.sin(dir);
      const linePos = ((proj % strokeSpacing) + strokeSpacing) % strokeSpacing;
      const lineCoverage = 0.5 + 0.5 * Math.cos(2 * Math.PI * linePos / strokeSpacing);

      const edgeFactor = Math.min(1, edge / 100);
      const strokeIntensity = darkness * (0.15 + (0.15 + edgeFactor * 0.7) * lineCoverage);

      const r = Math.round(paperColor[0] + (pencilColor[0] - paperColor[0]) * strokeIntensity);
      const g = Math.round(paperColor[1] + (pencilColor[1] - paperColor[1]) * strokeIntensity);
      const b = Math.round(paperColor[2] + (pencilColor[2] - paperColor[2]) * strokeIntensity);

      outBuf[i] = r;
      outBuf[i + 1] = g;
      outBuf[i + 2] = b;
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  return applyPalettePassToCanvas(output, W, H, palette) ?? output;
};

export default defineFilter({ name: "Pencil Sketch", func: pencilSketch, optionTypes, options: defaults, defaults });
