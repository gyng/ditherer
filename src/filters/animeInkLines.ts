import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  clamp, cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor,
  logFilterBackend, logFilterWasmStatus,
} from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const EDGE_SOURCE = {
  SOBEL: "SOBEL",
  LAPLACIAN: "LAPLACIAN",
};

const RENDER_MODE = {
  SOLID: "SOLID",
  OVERLAY: "OVERLAY",
};

const laplacianEdges = (lum: Float32Array, W: number, H: number) => {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const idx = y * W + x;
      const c = lum[idx];
      const left = lum[idx - 1];
      const right = lum[idx + 1];
      const top = lum[idx - W];
      const bottom = lum[idx + W];
      out[idx] = Math.abs(left + right + top + bottom - c * 4);
    }
  }
  return out;
};

const thresholdMap = (magnitude: Float32Array, threshold: number, W: number, H: number) => {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < magnitude.length; i += 1) {
    out[i] = magnitude[i] >= threshold ? 1 : 0;
  }
  return out;
};

const dilate = (edgeMap: Uint8Array, W: number, H: number, lineWidth: number) => {
  const out = new Uint8Array(W * H);
  const radius = lineWidth > 1 ? (lineWidth - 1) / 2 : 0;
  const ceilRadius = Math.ceil(radius);
  const reach = radius + 0.35;

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (edgeMap[y * W + x] === 0) continue;
      for (let dy = -ceilRadius; dy <= ceilRadius; dy += 1) {
        for (let dx = -ceilRadius; dx <= ceilRadius; dx += 1) {
          if (Math.hypot(dx, dy) > reach) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            out[ny * W + nx] = 1;
          }
        }
      }
    }
  }

  return out;
};

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "Sobel", value: EDGE_SOURCE.SOBEL },
      { name: "Laplacian", value: EDGE_SOURCE.LAPLACIAN },
    ],
    default: EDGE_SOURCE.SOBEL,
    desc: "Which edge detector to use for the line pass",
  },
  threshold: { type: RANGE, range: [5, 180], step: 1, default: 34, desc: "Minimum edge strength that becomes an ink line" },
  lineWidth: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1.1, desc: "Thickness of the anime line art" },
  lineColor: { type: COLOR, default: [32, 24, 24], desc: "Ink line color" },
  renderMode: {
    type: ENUM,
    options: [
      { name: "Overlay", value: RENDER_MODE.OVERLAY },
      { name: "Solid", value: RENDER_MODE.SOLID },
    ],
    default: RENDER_MODE.OVERLAY,
    desc: "Overlay lines on the source image or output only the line drawing",
  },
  overlayMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "How strongly ink lines darken or recolor the source image in Overlay mode" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background color for Solid mode" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  source: optionTypes.source.default,
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  renderMode: optionTypes.renderMode.default,
  overlayMix: optionTypes.overlayMix.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

// Single-pass GL: inline Sobel or Laplacian edge detection + dilation +
// overlay/solid render. Matches the JS pipeline but avoids intermediate
// buffers.
const AIL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_edgeSource;   // 0 SOBEL, 1 LAPLACIAN
uniform float u_threshold;
uniform int   u_ceilR;
uniform float u_reach;
uniform float u_edgeAlpha;
uniform vec3  u_lineColor;
uniform vec3  u_bgColor;
uniform int   u_overlay;      // 1 = overlay on source, 0 = solid
uniform float u_overlayMix;
uniform float u_lineWidth;

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y)).rgb;
}

float edgeMag(float x, float y) {
  if (u_edgeSource == 1) {
    // Laplacian: |L+R+T+B - 4C|
    float c = lum(samplePx(x, y)) * 255.0;
    float l = lum(samplePx(x-1.0, y)) * 255.0;
    float r = lum(samplePx(x+1.0, y)) * 255.0;
    float t = lum(samplePx(x, y-1.0)) * 255.0;
    float b = lum(samplePx(x, y+1.0)) * 255.0;
    return abs(l + r + t + b - c * 4.0);
  }
  // Sobel
  float a = lum(samplePx(x-1.0,y-1.0))*255.0;
  float b = lum(samplePx(x,   y-1.0))*255.0;
  float c = lum(samplePx(x+1.0,y-1.0))*255.0;
  float d = lum(samplePx(x-1.0,y    ))*255.0;
  float f = lum(samplePx(x+1.0,y    ))*255.0;
  float g = lum(samplePx(x-1.0,y+1.0))*255.0;
  float h = lum(samplePx(x,   y+1.0))*255.0;
  float iv= lum(samplePx(x+1.0,y+1.0))*255.0;
  float gx = (c+2.0*f+iv)-(a+2.0*d+g);
  float gy = (g+2.0*h+iv)-(a+2.0*b+c);
  return sqrt(gx*gx+gy*gy);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Dilated edge check: any pixel within reach with edge above threshold.
  bool isEdge = false;
  if (u_ceilR <= 0) {
    isEdge = edgeMag(x, y) >= u_threshold;
  } else {
    for (int ky = -4; ky <= 4; ky++) {
      if (ky < -u_ceilR || ky > u_ceilR) continue;
      for (int kx = -4; kx <= 4; kx++) {
        if (kx < -u_ceilR || kx > u_ceilR) continue;
        if (sqrt(float(kx*kx+ky*ky)) > u_reach) continue;
        if (edgeMag(x+float(kx), y+float(ky)) >= u_threshold) { isEdge = true; break; }
      }
      if (isEdge) break;
    }
  }

  vec3 src = samplePx(x, y);
  vec3 base = u_overlay == 1 ? src : u_bgColor;
  vec3 rgb;

  if (!isEdge) {
    rgb = base;
  } else if (u_overlay == 1) {
    float mix1 = clamp(u_overlayMix * u_edgeAlpha, 0.0, 1.0);
    rgb = mix(base, u_lineColor, mix1);
  } else if (u_lineWidth < 1.0) {
    rgb = mix(base, u_lineColor, u_edgeAlpha);
  } else {
    rgb = u_lineColor;
  }

  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { ail: Program };
let _glCache: Cache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): Cache => {
  if (_glCache) return _glCache;
  _glCache = {
    ail: linkProgram(gl, AIL_FS, [
      "u_source", "u_res", "u_edgeSource", "u_threshold",
      "u_ceilR", "u_reach", "u_edgeAlpha",
      "u_lineColor", "u_bgColor", "u_overlay", "u_overlayMix", "u_lineWidth",
    ] as const),
  };
  return _glCache;
};

const animeInkLines = (input: any, options = defaults) => {
  const { source, threshold, lineWidth, lineColor, renderMode, overlayMix, bgColor, palette } = options;
  const W = input.width, H = input.height;
  const radius = Math.max(0, lineWidth - 1);
  const ceilR = Math.ceil(radius);
  const reach = radius + 0.35;
  const edgeAlpha = Math.min(1, Math.max(0.1, lineWidth));
  const overlay = renderMode === RENDER_MODE.OVERLAY;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initGLCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "animeInkLines:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ail, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ail.uniforms.u_source, 0);
        gl.uniform2f(cache.ail.uniforms.u_res, W, H);
        gl.uniform1i(cache.ail.uniforms.u_edgeSource, source === EDGE_SOURCE.LAPLACIAN ? 1 : 0);
        gl.uniform1f(cache.ail.uniforms.u_threshold, threshold);
        gl.uniform1i(cache.ail.uniforms.u_ceilR, Math.min(4, ceilR));
        gl.uniform1f(cache.ail.uniforms.u_reach, reach);
        gl.uniform1f(cache.ail.uniforms.u_edgeAlpha, edgeAlpha);
        gl.uniform3f(cache.ail.uniforms.u_lineColor, lineColor[0] / 255, lineColor[1] / 255, lineColor[2] / 255);
        gl.uniform3f(cache.ail.uniforms.u_bgColor, bgColor[0] / 255, bgColor[1] / 255, bgColor[2] / 255);
        gl.uniform1i(cache.ail.uniforms.u_overlay, overlay ? 1 : 0);
        gl.uniform1f(cache.ail.uniforms.u_overlayMix, overlayMix);
        gl.uniform1f(cache.ail.uniforms.u_lineWidth, lineWidth);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Anime Ink Lines", "WebGL2",
            `${source} ${renderMode}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Anime Ink Lines", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = computeLuminance(buf, W, H);
  const magnitude = source === EDGE_SOURCE.LAPLACIAN
    ? laplacianEdges(lum, W, H)
    : sobelEdges(lum, W, H).magnitude;
  const edgeMap = thresholdMap(magnitude, threshold, W, H);
  const dilated = dilate(edgeMap, W, H, lineWidth);

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const isEdge = dilated[y * W + x] === 1;
      const baseR = overlay ? buf[i] : bgColor[0];
      const baseG = overlay ? buf[i + 1] : bgColor[1];
      const baseB = overlay ? buf[i + 2] : bgColor[2];

      let r = isEdge ? lineColor[0] : baseR;
      let g = isEdge ? lineColor[1] : baseG;
      let b = isEdge ? lineColor[2] : baseB;

      if (isEdge && overlay) {
        const mix = clamp(0, 1, overlayMix * edgeAlpha);
        r = Math.round(baseR + (lineColor[0] - baseR) * mix);
        g = Math.round(baseG + (lineColor[1] - baseG) * mix);
        b = Math.round(baseB + (lineColor[2] - baseB) * mix);
      }

      const color = srgbPaletteGetColor(
        palette,
        rgba(
          isEdge && !overlay && lineWidth < 1 ? Math.round(baseR + (r - baseR) * edgeAlpha) : r,
          isEdge && !overlay && lineWidth < 1 ? Math.round(baseG + (g - baseG) * edgeAlpha) : g,
          isEdge && !overlay && lineWidth < 1 ? Math.round(baseB + (b - baseB) * edgeAlpha) : b,
          255,
        ),
        palette.options,
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anime Ink Lines",
  func: animeInkLines,
  optionTypes,
  options: defaults,
  defaults,
});
