import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
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
  levels: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Number of flat color bands used for cel shading" },
  edgeThreshold: { type: RANGE, range: [0, 100], step: 1, default: 28, desc: "Edge sensitivity for the ink outline" },
  lineColor: { type: COLOR, default: [24, 18, 18], desc: "Outline color used for the cartoon ink pass" },
  lineWidth: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1, desc: "Thickness of the outline" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  edgeThreshold: optionTypes.edgeThreshold.default,
  lineColor: optionTypes.lineColor.default,
  lineWidth: optionTypes.lineWidth.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Single-pass: inline Sobel on luminance, max-dilate for lineWidth > 1,
// per-channel quantize to levels, overlay ink where edge exceeds threshold.
const TOON_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_levels;
uniform float u_edgeThreshold;
uniform vec3  u_lineColor;     // 0..1
uniform float u_lineWidth;
uniform int   u_ceilR;
uniform float u_reach;
uniform float u_edgeAlpha;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y)).rgb;
}

float sobelMag(float x, float y) {
  float a = lum(samplePx(x-1.0,y-1.0));
  float b = lum(samplePx(x,   y-1.0));
  float c = lum(samplePx(x+1.0,y-1.0));
  float d = lum(samplePx(x-1.0,y    ));
  float f = lum(samplePx(x+1.0,y    ));
  float g = lum(samplePx(x-1.0,y+1.0));
  float h = lum(samplePx(x,   y+1.0));
  float iv= lum(samplePx(x+1.0,y+1.0));
  float gx = (c + 2.0*f + iv) - (a + 2.0*d + g);
  float gy = (g + 2.0*h + iv) - (a + 2.0*b + c);
  return sqrt(gx*gx + gy*gy) * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Edge detection + optional dilation (max of neighbourhood Sobel).
  float edgeVal = 0.0;
  if (u_ceilR <= 0) {
    edgeVal = sobelMag(x, y);
  } else {
    for (int ky = -4; ky <= 4; ky++) {
      if (ky < -u_ceilR || ky > u_ceilR) continue;
      for (int kx = -4; kx <= 4; kx++) {
        if (kx < -u_ceilR || kx > u_ceilR) continue;
        if (sqrt(float(kx*kx + ky*ky)) > u_reach) continue;
        edgeVal = max(edgeVal, sobelMag(x + float(kx), y + float(ky)));
      }
    }
  }

  vec3 src = samplePx(x, y);
  // Per-channel posterize to u_levels bands.
  float step = 1.0 / max(1.0, u_levels - 1.0);
  vec3 poster = floor(src / step + 0.5) * step;

  vec3 rgb;
  if (edgeVal > u_edgeThreshold) {
    if (u_lineWidth < 1.0) {
      rgb = mix(poster, u_lineColor, u_edgeAlpha);
    } else {
      rgb = u_lineColor;
    }
  } else {
    rgb = poster;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { toon: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    toon: linkProgram(gl, TOON_FS, [
      "u_source", "u_res", "u_levels", "u_edgeThreshold",
      "u_lineColor", "u_lineWidth", "u_ceilR", "u_reach", "u_edgeAlpha",
    ] as const),
  };
  return _cache;
};

const toon = (input: any, options = defaults) => {
  const { levels, edgeThreshold, lineColor, lineWidth, palette } = options;
  const W = input.width, H = input.height;
  const radius = Math.max(0, lineWidth - 1);
  const ceilR = Math.ceil(radius);
  const reach = radius + 0.35;
  const edgeAlpha = Math.min(1, Math.max(0.1, lineWidth));

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "toon:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.toon, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.toon.uniforms.u_source, 0);
        gl.uniform2f(cache.toon.uniforms.u_res, W, H);
        gl.uniform1f(cache.toon.uniforms.u_levels, levels);
        gl.uniform1f(cache.toon.uniforms.u_edgeThreshold, edgeThreshold);
        gl.uniform3f(cache.toon.uniforms.u_lineColor, lineColor[0] / 255, lineColor[1] / 255, lineColor[2] / 255);
        gl.uniform1f(cache.toon.uniforms.u_lineWidth, lineWidth);
        gl.uniform1i(cache.toon.uniforms.u_ceilR, Math.min(4, ceilR));
        gl.uniform1f(cache.toon.uniforms.u_reach, reach);
        gl.uniform1f(cache.toon.uniforms.u_edgeAlpha, edgeAlpha);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Toon", "WebGL2",
            `levels=${levels} edge=${edgeThreshold}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Toon", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = computeLuminance(buf, W, H);
  const { magnitude } = sobelEdges(lum, W, H);
  const edgeMap = lineWidth > 1 ? new Float32Array(W * H) : magnitude;

  if (lineWidth > 1) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let maxVal = 0;
        for (let ky = -ceilR; ky <= ceilR; ky++) {
          for (let kx = -ceilR; kx <= ceilR; kx++) {
            if (Math.hypot(kx, ky) > reach) continue;
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            maxVal = Math.max(maxVal, magnitude[ny * W + nx]);
          }
        }
        edgeMap[y * W + x] = maxVal;
      }
    }
  }

  const step = 255 / Math.max(1, levels - 1);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      if (edgeMap[y * W + x] > edgeThreshold) {
        const edgeColor = srgbPaletteGetColor(palette, rgba(lineColor[0], lineColor[1], lineColor[2], 255), palette.options);
        if (lineWidth < 1) {
          const baseR = Math.round(Math.round(buf[i] / step) * step);
          const baseG = Math.round(Math.round(buf[i + 1] / step) * step);
          const baseB = Math.round(Math.round(buf[i + 2] / step) * step);
          const color = srgbPaletteGetColor(
            palette,
            rgba(
              Math.round(baseR + (edgeColor[0] - baseR) * edgeAlpha),
              Math.round(baseG + (edgeColor[1] - baseG) * edgeAlpha),
              Math.round(baseB + (edgeColor[2] - baseB) * edgeAlpha),
              255
            ),
            palette.options
          );
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
        } else {
          fillBufferPixel(outBuf, i, edgeColor[0], edgeColor[1], edgeColor[2], 255);
        }
        continue;
      }

      const r = Math.round(Math.round(buf[i] / step) * step);
      const g = Math.round(Math.round(buf[i + 1] / step) * step);
      const b = Math.round(Math.round(buf[i + 2] / step) * step);
      const color = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Toon",
  func: toon,
  optionTypes,
  options: defaults,
  defaults
});
