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
import { computeLuminance } from "utils/edges";
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
  type TexEntry,
} from "gl";

export const optionTypes = {
  sigma: { type: RANGE, range: [0.3, 5], step: 0.1, default: 1.4, desc: "Fine-scale Gaussian sigma — controls line sensitivity" },
  k: { type: RANGE, range: [1.2, 6], step: 0.1, default: 1.6, desc: "Ratio between the two Gaussian scales (σ vs kσ) — higher detects coarser edges" },
  sharpness: { type: RANGE, range: [1, 200], step: 1, default: 40, desc: "XDoG soft-threshold steepness — higher = crisper binary lines" },
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "XDoG threshold — below this the DoG goes to ink" },
  lineWidth: { type: RANGE, range: [0.1, 5], step: 0.1, default: 1, desc: "Dilate lines for thicker strokes" },
  cleanupRadius: { type: RANGE, range: [0, 3], step: 1, default: 1, desc: "Remove isolated noise pixels" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Ink/line color" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  sigma: optionTypes.sigma.default,
  k: optionTypes.k.default,
  sharpness: optionTypes.sharpness.default,
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  cleanupRadius: optionTypes.cleanupRadius.default,
  lineColor: optionTypes.lineColor.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

// ── GL XDoG pipeline ────────────────────────────────────────────────────
// Pass 1: source → luminance (R channel).
// Pass 2: horizontal Gaussian blur at σ → blurA.
// Pass 3: vertical Gaussian blur at σ → blurA (separable).
// Pass 4: horizontal Gaussian blur at kσ → blurB.
// Pass 5: vertical Gaussian blur at kσ → blurB.
// Pass 6: XDoG threshold (blurA - blurB → soft threshold → edge mask).
// Pass 7: dilate (if lineWidth > 1).
// Pass 8: cleanup + render colour.

const MAX_KERNEL = 30; // half-width cap for Gaussian kernel

const LUMA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  vec4 c = texture(u_source, v_uv);
  float l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  fragColor = vec4(l, 0.0, 0.0, 1.0);
}
`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_axis;
uniform int   u_radius;
uniform float u_weights[${MAX_KERNEL * 2 + 1}];
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  float acc = 0.0;
  for (int k = -${MAX_KERNEL}; k <= ${MAX_KERNEL}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    vec2 uv = vec2((nx + 0.5) / u_res.x, (ny + 0.5) / u_res.y);
    acc += texture(u_input, uv).r * u_weights[k + ${MAX_KERNEL}];
  }
  fragColor = vec4(acc, 0.0, 0.0, 1.0);
}
`;

// XDoG: D(x) = G_σ - G_kσ. If D(x) ≥ 0 (or luma high enough) → white.
// Otherwise apply a soft tanh threshold: 1 + tanh(sharpness * (D - ε)).
const XDOG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_blurA;   // G_σ
uniform sampler2D u_blurB;   // G_kσ
uniform float u_sharpness;
uniform float u_threshold;   // ε in [0,1]
void main() {
  float a = texture(u_blurA, v_uv).r;
  float b = texture(u_blurB, v_uv).r;
  float d = a - b;
  float edge;
  if (d >= 0.0) {
    edge = 1.0;
  } else {
    edge = 1.0 + tanh(u_sharpness * (d + u_threshold));
  }
  edge = clamp(edge, 0.0, 1.0);
  // edge ~ 1 = background, ~ 0 = line
  fragColor = vec4(edge, 0.0, 0.0, 1.0);
}
`;

// Dilate: erode white → expand dark lines. min() over circular window.
const DILATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_ceilR;
uniform float u_reach;
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  float minVal = 1.0;
  for (int ky = -4; ky <= 4; ky++) {
    if (ky < -u_ceilR || ky > u_ceilR) continue;
    for (int kx = -4; kx <= 4; kx++) {
      if (kx < -u_ceilR || kx > u_ceilR) continue;
      if (sqrt(float(kx*kx + ky*ky)) > u_reach) continue;
      float nx = clamp(x + float(kx), 0.0, u_res.x - 1.0);
      float ny = clamp(y + float(ky), 0.0, u_res.y - 1.0);
      vec2 uv = vec2((nx + 0.5) / u_res.x, (ny + 0.5) / u_res.y);
      minVal = min(minVal, texture(u_input, uv).r);
    }
  }
  fragColor = vec4(minVal, 0.0, 0.0, 1.0);
}
`;

// Cleanup + colour: require ≥2 dark neighbours to keep a dark pixel.
const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_edges;
uniform vec2  u_res;
uniform int   u_cleanupR;
uniform vec3  u_lineColor;
uniform vec3  u_bgColor;
float edgeAt(float x, float y) {
  float cx = clamp(x, 0.0, u_res.x - 1.0);
  float cy = clamp(y, 0.0, u_res.y - 1.0);
  return texture(u_edges, vec2((cx + 0.5) / u_res.x, (cy + 0.5) / u_res.y)).r;
}
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  float self = edgeAt(x, y);
  bool isLine;
  if (self > 0.5) {
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
        if (edgeAt(x + float(kx), y + float(ky)) < 0.5) neighbors++;
      }
    }
    isLine = neighbors >= 2;
  }
  vec3 rgb = isLine ? u_lineColor : u_bgColor;
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = {
  luma: Program; blur: Program; xdog: Program;
  dilate: Program; render: Program;
};
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    luma: linkProgram(gl, LUMA_FS, ["u_source"] as const),
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res", "u_axis", "u_radius", "u_weights"] as const),
    xdog: linkProgram(gl, XDOG_FS, ["u_blurA", "u_blurB", "u_sharpness", "u_threshold"] as const),
    dilate: linkProgram(gl, DILATE_FS, ["u_input", "u_res", "u_ceilR", "u_reach"] as const),
    render: linkProgram(gl, RENDER_FS, ["u_edges", "u_res", "u_cleanupR", "u_lineColor", "u_bgColor"] as const),
  };
  return _cache;
};

const buildKernel = (sigma: number): { radius: number; weights: Float32Array } => {
  const radius = Math.min(MAX_KERNEL, Math.max(1, Math.ceil(sigma * 3)));
  const weights = new Float32Array(MAX_KERNEL * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights[i + MAX_KERNEL] = w;
    sum += w;
  }
  for (let i = -radius; i <= radius; i++) weights[i + MAX_KERNEL] /= sum;
  return { radius, weights };
};

const runBlurPasses = (
  gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject,
  cache: Cache, input: TexEntry, temp: TexEntry, output: TexEntry,
  W: number, H: number, sigma: number,
) => {
  const { radius, weights } = buildKernel(sigma);
  // Horizontal
  drawPass(gl, temp, W, H, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, W, H);
    gl.uniform2f(cache.blur.uniforms.u_axis, 1, 0);
    gl.uniform1i(cache.blur.uniforms.u_radius, radius);
    gl.uniform1fv(cache.blur.uniforms.u_weights, weights);
  }, vao);
  // Vertical
  drawPass(gl, output, W, H, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, W, H);
    gl.uniform2f(cache.blur.uniforms.u_axis, 0, 1);
    gl.uniform1i(cache.blur.uniforms.u_radius, radius);
    gl.uniform1fv(cache.blur.uniforms.u_weights, weights);
  }, vao);
};

const lineArt = (input: any, options = defaults) => {
  const { sigma, k, sharpness, threshold, lineWidth, cleanupRadius, lineColor, bgColor, palette } = options;
  const W = input.width, H = input.height;
  const radius = Math.max(0, lineWidth - 1);
  const ceilR = Math.ceil(radius);
  const reach = radius + 0.35;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "lineArt:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);
      const lumaTex: TexEntry = ensureTexture(gl, "lineArt:luma", W, H);
      const blurTemp: TexEntry = ensureTexture(gl, "lineArt:blurTemp", W, H);
      const blurA: TexEntry = ensureTexture(gl, "lineArt:blurA", W, H);
      const blurB: TexEntry = ensureTexture(gl, "lineArt:blurB", W, H);
      const xdogTex: TexEntry = ensureTexture(gl, "lineArt:xdog", W, H);
      const dilateTex: TexEntry = ensureTexture(gl, "lineArt:dilate", W, H);

      // 1. Luminance
      drawPass(gl, lumaTex, W, H, cache.luma, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.luma.uniforms.u_source, 0);
      }, vao);

      // 2-3. Blur at σ
      runBlurPasses(gl, vao, cache, lumaTex, blurTemp, blurA, W, H, sigma);

      // 4-5. Blur at kσ
      runBlurPasses(gl, vao, cache, lumaTex, blurTemp, blurB, W, H, sigma * k);

      // 6. XDoG threshold
      drawPass(gl, xdogTex, W, H, cache.xdog, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
        gl.uniform1i(cache.xdog.uniforms.u_blurA, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
        gl.uniform1i(cache.xdog.uniforms.u_blurB, 1);
        gl.uniform1f(cache.xdog.uniforms.u_sharpness, sharpness);
        gl.uniform1f(cache.xdog.uniforms.u_threshold, threshold);
      }, vao);

      // 7. Dilate (if lineWidth > 1)
      let edgeResult = xdogTex;
      if (lineWidth > 1) {
        drawPass(gl, dilateTex, W, H, cache.dilate, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, xdogTex.tex);
          gl.uniform1i(cache.dilate.uniforms.u_input, 0);
          gl.uniform2f(cache.dilate.uniforms.u_res, W, H);
          gl.uniform1i(cache.dilate.uniforms.u_ceilR, Math.min(4, ceilR));
          gl.uniform1f(cache.dilate.uniforms.u_reach, reach);
        }, vao);
        edgeResult = dilateTex;
      }

      // 8. Cleanup + render → default framebuffer
      drawPass(gl, null, W, H, cache.render, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, edgeResult.tex);
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
            `XDoG σ=${sigma} k=${k} p=${sharpness}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  // ── JS fallback: XDoG via two separable Gaussian blurs ──
  logFilterWasmStatus("Line Art", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const lum = computeLuminance(buf, W, H);
  // Normalise to 0..1
  const lumF = new Float32Array(W * H);
  for (let i = 0; i < lum.length; i++) lumF[i] = lum[i] / 255;

  // Separable Gaussian blur helper
  const gaussBlur = (src: Float32Array, sig: number): Float32Array => {
    const rad = Math.min(MAX_KERNEL, Math.max(1, Math.ceil(sig * 3)));
    const kern = new Float32Array(rad * 2 + 1);
    let kSum = 0;
    for (let i = -rad; i <= rad; i++) { kern[i + rad] = Math.exp(-(i * i) / (2 * sig * sig)); kSum += kern[i + rad]; }
    for (let i = 0; i < kern.length; i++) kern[i] /= kSum;

    // Horizontal
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let ki = -rad; ki <= rad; ki++) {
          const nx = Math.max(0, Math.min(W - 1, x + ki));
          v += src[y * W + nx] * kern[ki + rad];
        }
        tmp[y * W + x] = v;
      }
    // Vertical
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let ki = -rad; ki <= rad; ki++) {
          const ny = Math.max(0, Math.min(H - 1, y + ki));
          v += tmp[ny * W + x] * kern[ki + rad];
        }
        out[y * W + x] = v;
      }
    return out;
  };

  const gA = gaussBlur(lumF, sigma);
  const gB = gaussBlur(lumF, sigma * k);

  // XDoG threshold
  const edgeMask = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = gA[i] - gB[i];
    edgeMask[i] = d >= 0 ? 1 : Math.max(0, Math.min(1, 1 + Math.tanh(sharpness * (d + threshold))));
  }

  // Dilate (min-filter to expand dark lines)
  let finalEdges = edgeMask;
  if (lineWidth > 1) {
    finalEdges = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let minVal = 1;
        for (let ky = -ceilR; ky <= ceilR; ky++)
          for (let kx = -ceilR; kx <= ceilR; kx++) {
            if (Math.hypot(kx, ky) > reach) continue;
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            minVal = Math.min(minVal, edgeMask[ny * W + nx]);
          }
        finalEdges[y * W + x] = minVal;
      }
  }

  // Cleanup + render
  if (cleanupRadius > 0) {
    const cleaned = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (finalEdges[y * W + x] > 0.5) { cleaned[y * W + x] = 1; continue; }
        let neighbors = 0;
        for (let ky = -cleanupRadius; ky <= cleanupRadius; ky++)
          for (let kx = -cleanupRadius; kx <= cleanupRadius; kx++) {
            if (kx === 0 && ky === 0) continue;
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            if (finalEdges[ny * W + nx] < 0.5) neighbors++;
          }
        cleaned[y * W + x] = neighbors >= 2 ? 0 : 1;
      }
    finalEdges = cleaned;
  }

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const isEdge = finalEdges[y * W + x] < 0.5;
      const c = isEdge ? lineColor : bgColor;
      const color = paletteGetColor(palette, rgba(c[0], c[1], c[2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Line Art", func: lineArt, optionTypes, options: defaults, defaults });
