import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
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
  dotSize: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Circular pin-strike diameter in pixels" },
  spacing: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Edge-to-edge gap between pin positions" },
  inkDensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Maximum fraction of pin positions that fire" },
  inkColor: { type: COLOR, default: [10, 10, 40], desc: "Dot ink color" },
  paperColor: { type: COLOR, default: [240, 235, 220], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  spacing: optionTypes.spacing.default,
  inkDensity: optionTypes.inkDensity.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Fixed circular printer-pin strikes. A 4x4 ordered threshold over cells
// represents tone by firing frequency, while 4x4 alpha-weighted source samples
// prevent transparent RGB from affecting the result.
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

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

float bayer4(ivec2 cell) {
  int x = ((cell.x % 4) + 4) % 4;
  int y = ((cell.y % 4) + 4) % 4;
  int ranks[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(ranks[y * 4 + x]) + 0.5) / 16.0;
}

float smoothUnit(float edge0, float edge1, float value) {
  float t = clamp((value - edge0) / max(edge1 - edge0, 1e-5), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Which cell does this pixel belong to?
  float cx = floor(x / u_cellSize) * u_cellSize;
  float cy = floor(y / u_cellSize) * u_cellSize;
  float centerX = cx + u_cellSize * 0.5;
  float centerY = cy + u_cellSize * 0.5;

  float weightedLuma = 0.0;
  float alphaWeight = 0.0;
  for (int sy = 0; sy < 4; sy++) {
    for (int sx = 0; sx < 4; sx++) {
      float sampleX = clamp(floor(cx + (float(sx) + 0.5) * u_cellSize / 4.0), 0.0, u_res.x - 1.0);
      float sampleY = clamp(floor(cy + (float(sy) + 0.5) * u_cellSize / 4.0), 0.0, u_res.y - 1.0);
      vec4 sampleValue = texture(u_source, vec2((sampleX + 0.5) / u_res.x, 1.0 - (sampleY + 0.5) / u_res.y));
      weightedLuma += lum(sampleValue.rgb) * sampleValue.a;
      alphaWeight += sampleValue.a;
    }
  }
  float averageLuma = alphaWeight > 1e-5 ? weightedLuma / alphaWeight : 1.0;
  float density = clamp((1.0 - averageLuma) * u_inkDensity, 0.0, 1.0);
  ivec2 cell = ivec2(floor(cx / u_cellSize), floor(cy / u_cellSize));
  float fired = step(bayer4(cell), density);
  float distanceToPin = length(vec2(x + 0.5 - centerX, y + 0.5 - centerY));
  float radius = u_dotSize * 0.5;
  float coverage = fired * (1.0 - smoothUnit(radius - 0.5, radius + 0.5, distanceToPin));
  vec4 source = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y));
  fragColor = vec4(mix(u_paperColor, u_inkColor, coverage), source.a);
}
`;

type Cache = { dm: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    dm: linkProgram(gl, DM_FS, [
      "u_source", "u_res", "u_cellSize", "u_dotSize",
      "u_inkDensity", "u_inkColor", "u_paperColor",
    ] as const),
  };
  return _cache;
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const validColor = (value: unknown, fallback: number[]): number[] => (
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(channel => Number.isFinite(Number(channel)))
    ? value.slice(0, 3).map(channel => Math.max(0, Math.min(255, Number(channel))))
    : fallback
);

const dotMatrix = (input: any, options: Partial<typeof defaults> & { _webglAcceleration?: boolean } = defaults) => {
  const dotSize = Math.round(finite(options.dotSize, defaults.dotSize, 2, 12));
  const spacing = Math.round(finite(options.spacing, defaults.spacing, 1, 8));
  const inkDensity = finite(options.inkDensity, defaults.inkDensity, 0, 1);
  const inkColor = validColor(options.inkColor, defaults.inkColor);
  const paperColor = validColor(options.paperColor, defaults.paperColor);
  const palette = options.palette ?? defaults.palette;
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

  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      let weightedLuma = 0;
      let alphaWeight = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const sampleX = Math.max(0, Math.min(W - 1, Math.floor(cx + (sx + 0.5) * cellSize / 4)));
          const sampleY = Math.max(0, Math.min(H - 1, Math.floor(cy + (sy + 0.5) * cellSize / 4)));
          const i = getBufferIndex(sampleX, sampleY, W);
          const alpha = buf[i + 3] / 255;
          weightedLuma += (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255 * alpha;
          alphaWeight += alpha;
        }
      }
      const averageLuma = alphaWeight > 1e-5 ? weightedLuma / alphaWeight : 1;
      const density = Math.max(0, Math.min(1, (1 - averageLuma) * inkDensity));
      const ranks = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const cellX = Math.floor(cx / cellSize) & 3;
      const cellY = Math.floor(cy / cellSize) & 3;
      const fired = density >= (ranks[cellY * 4 + cellX] + 0.5) / 16;

      const centerX = cx + cellSize / 2;
      const centerY = cy + cellSize / 2;
      for (let py = cy; py < Math.min(H, cy + cellSize); py++) {
        for (let px = cx; px < Math.min(W, cx + cellSize); px++) {
          const i = getBufferIndex(px, py, W);
          const distance = Math.hypot(px + 0.5 - centerX, py + 0.5 - centerY);
          const edge0 = dotSize / 2 - 0.5;
          const edge1 = dotSize / 2 + 0.5;
          const t = Math.max(0, Math.min(1, (distance - edge0) / Math.max(1e-5, edge1 - edge0)));
          const coverage = fired ? 1 - t * t * (3 - 2 * t) : 0;
          outBuf[i] = Math.round(paperColor[0] + (inkColor[0] - paperColor[0]) * coverage);
          outBuf[i + 1] = Math.round(paperColor[1] + (inkColor[1] - paperColor[1]) * coverage);
          outBuf[i + 2] = Math.round(paperColor[2] + (inkColor[2] - paperColor[2]) * coverage);
          outBuf[i + 3] = buf[i + 3];
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  return applyPalettePassToCanvas(output, W, H, palette) ?? output;
};

export default defineFilter({
  name: "Dot Matrix",
  func: dotMatrix,
  optionTypes,
  options: defaults,
  defaults
});
