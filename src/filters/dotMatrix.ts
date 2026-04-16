import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
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
  dotSize: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Maximum dot radius" },
  spacing: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Gap between dot centers" },
  inkDensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "How fully dots fill their cells" },
  inkColor: { type: COLOR, default: [10, 10, 40], desc: "Dot ink color" },
  paperColor: { type: COLOR, default: [240, 235, 220], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  spacing: optionTypes.spacing.default,
  inkDensity: optionTypes.inkDensity.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Shader computes the cell grid per output pixel, averages the source
// luminance across the cell (sampling at cell centre — cheaper than true
// per-pixel average, visually close enough), sizes a square pin-strike
// dot by darkness, and varies ink intensity along the vertical axis to
// mimic the printhead pins.
const DM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_cellSize;
uniform float u_dotSize;
uniform float u_inkDensity;
uniform vec3  u_inkColor;
uniform vec3  u_paperColor;
uniform float u_levels;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Which cell does this pixel belong to?
  float cx = floor(x / u_cellSize) * u_cellSize;
  float cy = floor(y / u_cellSize) * u_cellSize;
  float centerX = cx + u_cellSize * 0.5;
  float centerY = cy + u_cellSize * 0.5;

  // Sample source luminance at cell centre (fast proxy for averaging).
  float scx = clamp(floor(centerX), 0.0, u_res.x - 1.0);
  float scy = clamp(floor(centerY), 0.0, u_res.y - 1.0);
  vec2 suv = vec2((scx + 0.5) / u_res.x, 1.0 - (scy + 0.5) / u_res.y);
  float avgLum = lum(texture(u_source, suv).rgb);

  float darkness = (1.0 - avgLum) * u_inkDensity;
  float maxR = u_dotSize * 0.5;
  float dotR = maxR * darkness;

  // Distance from pixel to cell centre — square (Chebyshev) for pin-strike.
  float dx = x - centerX;
  float dy = y - centerY;
  float halfDot = ceil(dotR);

  if (dotR < 0.3 || abs(dx) > halfDot || abs(dy) > halfDot) {
    vec3 paper = u_paperColor;
    if (u_levels > 1.5) {
      float q = u_levels - 1.0;
      paper = floor(paper * q + 0.5) / q;
    }
    fragColor = vec4(paper, 1.0);
    return;
  }

  // Ink intensity varies vertically like real pin impacts.
  float intensity = min(1.0, darkness * (0.8 + 0.2 * abs(dy / max(halfDot, 1.0))));
  vec3 rgb = mix(u_paperColor, u_inkColor, intensity);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { dm: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    dm: linkProgram(gl, DM_FS, [
      "u_source", "u_res", "u_cellSize", "u_dotSize",
      "u_inkDensity", "u_inkColor", "u_paperColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const dotMatrix = (input: any, options = defaults) => {
  const { dotSize, spacing, inkDensity, inkColor, paperColor, palette } = options;
  const W = input.width, H = input.height;
  const cellSize = dotSize + spacing;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "dotMatrix:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.dm, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.dm.uniforms.u_source, 0);
        gl.uniform2f(cache.dm.uniforms.u_res, W, H);
        gl.uniform1f(cache.dm.uniforms.u_cellSize, cellSize);
        gl.uniform1f(cache.dm.uniforms.u_dotSize, dotSize);
        gl.uniform1f(cache.dm.uniforms.u_inkDensity, inkDensity);
        gl.uniform3f(cache.dm.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
        gl.uniform3f(cache.dm.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.dm.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Dot Matrix", "WebGL2",
            `size=${dotSize}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Dot Matrix", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paperColor[0];
    outBuf[i + 1] = paperColor[1];
    outBuf[i + 2] = paperColor[2];
    outBuf[i + 3] = 255;
  }

  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      let totalLum = 0;
      let count = 0;
      for (let dy = 0; dy < cellSize && cy + dy < H; dy++) {
        for (let dx = 0; dx < cellSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          totalLum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          count++;
        }
      }
      const avgLum = totalLum / count / 255;
      const darkness = (1 - avgLum) * inkDensity;

      const maxR = dotSize / 2;
      const dotR = maxR * darkness;
      if (dotR < 0.3) continue;

      const centerX = cx + cellSize / 2;
      const centerY = cy + cellSize / 2;
      const halfDot = Math.ceil(dotR);

      for (let dy = -halfDot; dy <= halfDot; dy++) {
        for (let dx = -halfDot; dx <= halfDot; dx++) {
          const px = Math.round(centerX + dx);
          const py = Math.round(centerY + dy);
          if (px < 0 || px >= W || py < 0 || py >= H) continue;

          const i = getBufferIndex(px, py, W);
          const intensity = Math.min(1, darkness * (0.8 + 0.2 * Math.abs(dy / halfDot)));
          const r = Math.round(paperColor[0] + (inkColor[0] - paperColor[0]) * intensity);
          const g = Math.round(paperColor[1] + (inkColor[1] - paperColor[1]) * intensity);
          const b = Math.round(paperColor[2] + (inkColor[2] - paperColor[2]) * intensity);

          const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Dot Matrix",
  func: dotMatrix,
  optionTypes,
  options: defaults,
  defaults
});
