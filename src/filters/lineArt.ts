import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
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

const MODE = { SOBEL: "SOBEL", XDOG: "XDOG", FDOG: "FDOG" };

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "XDoG (default)", value: MODE.XDOG },
      { name: "FDoG (flow-aligned)", value: MODE.FDOG },
      { name: "Sobel (classic)", value: MODE.SOBEL },
    ],
    default: MODE.XDOG,
    desc: "Edge detection algorithm — XDoG for clean manga lines, FDoG for contour-following strokes, Sobel for the classic look"
  },
  sigma: { type: RANGE, range: [0.3, 5], step: 0.1, default: 0.3, desc: "Fine-scale Gaussian sigma — controls line sensitivity (XDoG/FDoG)" },
  k: { type: RANGE, range: [1.2, 6], step: 0.1, default: 4.5, desc: "Ratio between the two Gaussian scales (XDoG/FDoG)" },
  sharpness: { type: RANGE, range: [1, 200], step: 1, default: 65, desc: "Soft-threshold steepness — higher = crisper binary lines (XDoG/FDoG)" },
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0, desc: "Edge threshold — XDoG/FDoG: ε for tanh gate; Sobel: scaled to 0-100 sensitivity" },
  flowSamples: { type: RANGE, range: [5, 30], step: 1, default: 15, desc: "Samples along the tangent direction for FDoG flow blur", visibleWhen: (opts: any) => opts.mode === MODE.FDOG },
  lineWidth: { type: RANGE, range: [0.1, 5], step: 0.1, default: 1.2, desc: "Dilate lines for thicker strokes" },
  cleanupRadius: { type: RANGE, range: [0, 3], step: 1, default: 1, desc: "Remove isolated noise pixels" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Ink/line color" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  sigma: optionTypes.sigma.default,
  k: optionTypes.k.default,
  sharpness: optionTypes.sharpness.default,
  threshold: optionTypes.threshold.default,
  flowSamples: optionTypes.flowSamples.default,
  lineWidth: optionTypes.lineWidth.default,
  cleanupRadius: optionTypes.cleanupRadius.default,
  lineColor: optionTypes.lineColor.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

// ── Shared shaders ──────────────────────────────────────────────────────
const MAX_KERNEL = 30;

const LUMA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 0.0, 0.0, 1.0);
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
  float x = floor(px.x), y = floor(px.y);
  float acc = 0.0;
  for (int k = -${MAX_KERNEL}; k <= ${MAX_KERNEL}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    acc += texture(u_input, vec2((nx + 0.5) / u_res.x, (ny + 0.5) / u_res.y)).r * u_weights[k + ${MAX_KERNEL}];
  }
  fragColor = vec4(acc, 0.0, 0.0, 1.0);
}
`;

const XDOG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_blurA;
uniform sampler2D u_blurB;
uniform float u_sharpness;
uniform float u_threshold;
void main() {
  float a = texture(u_blurA, v_uv).r;
  float b = texture(u_blurB, v_uv).r;
  float d = a - b;
  float edge = d >= 0.0 ? 1.0 : 1.0 + tanh(u_sharpness * (d + u_threshold));
  fragColor = vec4(clamp(edge, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

// ── Sobel shader ────────────────────────────────────────────────────────
const SOBEL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform float u_threshold;
float lumAt(float x, float y) {
  float cx = clamp(x, 0.0, u_res.x - 1.0);
  float cy = clamp(y, 0.0, u_res.y - 1.0);
  return texture(u_input, vec2((cx+0.5)/u_res.x, (cy+0.5)/u_res.y)).r;
}
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  float a=lumAt(x-1.0,y-1.0), b=lumAt(x,y-1.0), c=lumAt(x+1.0,y-1.0);
  float d=lumAt(x-1.0,y),                        f=lumAt(x+1.0,y);
  float g=lumAt(x-1.0,y+1.0), h=lumAt(x,y+1.0), iv=lumAt(x+1.0,y+1.0);
  float gx = (c+2.0*f+iv)-(a+2.0*d+g);
  float gy = (g+2.0*h+iv)-(a+2.0*b+c);
  float mag = sqrt(gx*gx+gy*gy) * 255.0;
  fragColor = vec4(mag > u_threshold ? 0.0 : 1.0, 0.0, 0.0, 1.0);
}
`;

// ── FDoG shaders ────────────────────────────────────────────────────────
// Compute initial tangent field from Sobel gradients (perpendicular to gradient).
const TANGENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
float lumAt(float x, float y) {
  return texture(u_input, vec2((clamp(x,0.0,u_res.x-1.0)+0.5)/u_res.x, (clamp(y,0.0,u_res.y-1.0)+0.5)/u_res.y)).r;
}
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  float a=lumAt(x-1.0,y-1.0), b=lumAt(x,y-1.0), c=lumAt(x+1.0,y-1.0);
  float d=lumAt(x-1.0,y),                        f=lumAt(x+1.0,y);
  float g=lumAt(x-1.0,y+1.0), h=lumAt(x,y+1.0), iv=lumAt(x+1.0,y+1.0);
  float gx = (c+2.0*f+iv)-(a+2.0*d+g);
  float gy = (g+2.0*h+iv)-(a+2.0*b+c);
  float mag = sqrt(gx*gx+gy*gy);
  // Tangent = 90° rotated gradient (perpendicular to edge normal).
  vec2 t = mag > 1e-5 ? vec2(-gy, gx) / mag : vec2(1.0, 0.0);
  // Store tangent (RG) + magnitude (B) for ETF weighting.
  fragColor = vec4(t * 0.5 + 0.5, mag / 4.0, 1.0);
}
`;

// ETF refinement: average tangent with neighbours weighted by direction
// agreement and magnitude. 3 iterations recommended.
const ETF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tangent;
uniform vec2  u_res;
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  vec4 self = texture(u_tangent, v_uv);
  vec2 tSelf = self.rg * 2.0 - 1.0;
  float mSelf = self.b;
  vec2 acc = vec2(0.0);
  float wSum = 0.0;
  for (int ky = -2; ky <= 2; ky++) {
    for (int kx = -2; kx <= 2; kx++) {
      float nx = clamp(x + float(kx), 0.0, u_res.x - 1.0);
      float ny = clamp(y + float(ky), 0.0, u_res.y - 1.0);
      vec4 n = texture(u_tangent, vec2((nx+0.5)/u_res.x, (ny+0.5)/u_res.y));
      vec2 tN = n.rg * 2.0 - 1.0;
      float mN = n.b;
      float wd = abs(dot(tSelf, tN));          // direction agreement
      float wm = (0.5 + mN) * (0.5 + mSelf);  // magnitude weighting
      float ws = exp(-float(kx*kx + ky*ky) / 4.0); // spatial falloff
      float w = wd * wm * ws;
      // Flip neighbour tangent if it points opposite to ours so the
      // averaging stays coherent.
      float sign = dot(tSelf, tN) >= 0.0 ? 1.0 : -1.0;
      acc += tN * sign * w;
      wSum += w;
    }
  }
  vec2 tNew = wSum > 1e-6 ? normalize(acc / wSum) : tSelf;
  fragColor = vec4(tNew * 0.5 + 0.5, mSelf, 1.0);
}
`;

// Flow-aligned 1D Gaussian blur: sample along the tangent direction.
const FLOW_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;    // luminance
uniform sampler2D u_tangent;  // ETF field
uniform vec2  u_res;
uniform float u_sigma;
uniform int   u_samples;
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  vec4 tData = texture(u_tangent, v_uv);
  vec2 t = tData.rg * 2.0 - 1.0;
  float acc = 0.0, wSum = 0.0;
  float denom = 2.0 * u_sigma * u_sigma;
  for (int i = -30; i <= 30; i++) {
    if (i < -u_samples || i > u_samples) continue;
    float fi = float(i);
    float w = exp(-(fi * fi) / denom);
    vec2 pos = vec2(x, y) + t * fi;
    pos = clamp(pos, vec2(0.0), u_res - vec2(1.0));
    acc += texture(u_input, vec2((pos.x+0.5)/u_res.x, (pos.y+0.5)/u_res.y)).r * w;
    wSum += w;
  }
  fragColor = vec4(acc / max(wSum, 1e-6), 0.0, 0.0, 1.0);
}
`;

// Dilate (min-filter for expanding dark lines).
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
  float x = floor(px.x), y = floor(px.y);
  float minVal = 1.0;
  for (int ky = -4; ky <= 4; ky++) {
    if (ky < -u_ceilR || ky > u_ceilR) continue;
    for (int kx = -4; kx <= 4; kx++) {
      if (kx < -u_ceilR || kx > u_ceilR) continue;
      if (sqrt(float(kx*kx+ky*ky)) > u_reach) continue;
      float nx = clamp(x+float(kx), 0.0, u_res.x-1.0);
      float ny = clamp(y+float(ky), 0.0, u_res.y-1.0);
      minVal = min(minVal, texture(u_input, vec2((nx+0.5)/u_res.x,(ny+0.5)/u_res.y)).r);
    }
  }
  fragColor = vec4(minVal, 0.0, 0.0, 1.0);
}
`;

// Cleanup + render colour.
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
  return texture(u_edges, vec2((clamp(x,0.0,u_res.x-1.0)+0.5)/u_res.x, (clamp(y,0.0,u_res.y-1.0)+0.5)/u_res.y)).r;
}
void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x), y = floor(px.y);
  float self = edgeAt(x, y);
  bool isLine;
  if (self > 0.5) { isLine = false; }
  else if (u_cleanupR <= 0) { isLine = true; }
  else {
    int nb = 0;
    for (int ky = -3; ky <= 3; ky++) {
      if (ky < -u_cleanupR || ky > u_cleanupR) continue;
      for (int kx = -3; kx <= 3; kx++) {
        if (kx < -u_cleanupR || kx > u_cleanupR) continue;
        if (kx == 0 && ky == 0) continue;
        if (edgeAt(x+float(kx), y+float(ky)) < 0.5) nb++;
      }
    }
    isLine = nb >= 2;
  }
  fragColor = vec4(isLine ? u_lineColor : u_bgColor, 1.0);
}
`;

// ── Cache ───────────────────────────────────────────────────────────────
type Cache = {
  luma: Program; blur: Program; xdog: Program; sobel: Program;
  tangent: Program; etf: Program; flowBlur: Program;
  dilate: Program; render: Program;
};
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    luma: linkProgram(gl, LUMA_FS, ["u_source"] as const),
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res", "u_axis", "u_radius", "u_weights"] as const),
    xdog: linkProgram(gl, XDOG_FS, ["u_blurA", "u_blurB", "u_sharpness", "u_threshold"] as const),
    sobel: linkProgram(gl, SOBEL_FS, ["u_input", "u_res", "u_threshold"] as const),
    tangent: linkProgram(gl, TANGENT_FS, ["u_input", "u_res"] as const),
    etf: linkProgram(gl, ETF_FS, ["u_tangent", "u_res"] as const),
    flowBlur: linkProgram(gl, FLOW_BLUR_FS, ["u_input", "u_tangent", "u_res", "u_sigma", "u_samples"] as const),
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
  drawPass(gl, temp, W, H, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, W, H);
    gl.uniform2f(cache.blur.uniforms.u_axis, 1, 0);
    gl.uniform1i(cache.blur.uniforms.u_radius, radius);
    gl.uniform1fv(cache.blur.uniforms.u_weights, weights);
  }, vao);
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
  const { mode, sigma, k, sharpness, threshold, flowSamples, lineWidth, cleanupRadius, lineColor, bgColor, palette } = options;
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
      const edgeTex: TexEntry = ensureTexture(gl, "lineArt:edge", W, H);
      const dilateTex: TexEntry = ensureTexture(gl, "lineArt:dilate", W, H);

      // 1. Luminance
      drawPass(gl, lumaTex, W, H, cache.luma, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.luma.uniforms.u_source, 0);
      }, vao);

      if (mode === MODE.SOBEL) {
        // Sobel: single pass, threshold mapped from [0,1] to [0,100].
        drawPass(gl, edgeTex, W, H, cache.sobel, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lumaTex.tex);
          gl.uniform1i(cache.sobel.uniforms.u_input, 0);
          gl.uniform2f(cache.sobel.uniforms.u_res, W, H);
          gl.uniform1f(cache.sobel.uniforms.u_threshold, threshold * 100);
        }, vao);

      } else if (mode === MODE.FDOG) {
        // FDoG: tangent field → ETF refinement → flow-aligned blur.
        const tangentA: TexEntry = ensureTexture(gl, "lineArt:tangentA", W, H);
        const tangentB: TexEntry = ensureTexture(gl, "lineArt:tangentB", W, H);
        const flowA: TexEntry = ensureTexture(gl, "lineArt:flowA", W, H);
        const flowB: TexEntry = ensureTexture(gl, "lineArt:flowB", W, H);

        // Initial tangent field from Sobel gradients.
        drawPass(gl, tangentA, W, H, cache.tangent, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lumaTex.tex);
          gl.uniform1i(cache.tangent.uniforms.u_input, 0);
          gl.uniform2f(cache.tangent.uniforms.u_res, W, H);
        }, vao);

        // ETF refinement: 3 ping-pong passes.
        let etfSrc = tangentA, etfDst = tangentB;
        for (let pass = 0; pass < 3; pass++) {
          drawPass(gl, etfDst, W, H, cache.etf, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, etfSrc.tex);
            gl.uniform1i(cache.etf.uniforms.u_tangent, 0);
            gl.uniform2f(cache.etf.uniforms.u_res, W, H);
          }, vao);
          [etfSrc, etfDst] = [etfDst, etfSrc];
        }
        const etfResult = etfSrc;

        // Flow-aligned blur at σ.
        const samples = Math.max(3, Math.min(30, Math.round(flowSamples)));
        drawPass(gl, flowA, W, H, cache.flowBlur, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lumaTex.tex);
          gl.uniform1i(cache.flowBlur.uniforms.u_input, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, etfResult.tex);
          gl.uniform1i(cache.flowBlur.uniforms.u_tangent, 1);
          gl.uniform2f(cache.flowBlur.uniforms.u_res, W, H);
          gl.uniform1f(cache.flowBlur.uniforms.u_sigma, sigma);
          gl.uniform1i(cache.flowBlur.uniforms.u_samples, samples);
        }, vao);

        // Flow-aligned blur at kσ.
        drawPass(gl, flowB, W, H, cache.flowBlur, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lumaTex.tex);
          gl.uniform1i(cache.flowBlur.uniforms.u_input, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, etfResult.tex);
          gl.uniform1i(cache.flowBlur.uniforms.u_tangent, 1);
          gl.uniform2f(cache.flowBlur.uniforms.u_res, W, H);
          gl.uniform1f(cache.flowBlur.uniforms.u_sigma, sigma * k);
          gl.uniform1i(cache.flowBlur.uniforms.u_samples, samples);
        }, vao);

        // XDoG threshold on flow-blurred pair.
        drawPass(gl, edgeTex, W, H, cache.xdog, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, flowA.tex);
          gl.uniform1i(cache.xdog.uniforms.u_blurA, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, flowB.tex);
          gl.uniform1i(cache.xdog.uniforms.u_blurB, 1);
          gl.uniform1f(cache.xdog.uniforms.u_sharpness, sharpness);
          gl.uniform1f(cache.xdog.uniforms.u_threshold, threshold);
        }, vao);

      } else {
        // XDoG (default): isotropic separable blur.
        runBlurPasses(gl, vao, cache, lumaTex, blurTemp, blurA, W, H, sigma);
        runBlurPasses(gl, vao, cache, lumaTex, blurTemp, blurB, W, H, sigma * k);
        drawPass(gl, edgeTex, W, H, cache.xdog, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
          gl.uniform1i(cache.xdog.uniforms.u_blurA, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
          gl.uniform1i(cache.xdog.uniforms.u_blurB, 1);
          gl.uniform1f(cache.xdog.uniforms.u_sharpness, sharpness);
          gl.uniform1f(cache.xdog.uniforms.u_threshold, threshold);
        }, vao);
      }

      // Dilate (if lineWidth > 1)
      let finalEdge = edgeTex;
      if (lineWidth > 1) {
        drawPass(gl, dilateTex, W, H, cache.dilate, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, edgeTex.tex);
          gl.uniform1i(cache.dilate.uniforms.u_input, 0);
          gl.uniform2f(cache.dilate.uniforms.u_res, W, H);
          gl.uniform1i(cache.dilate.uniforms.u_ceilR, Math.min(4, ceilR));
          gl.uniform1f(cache.dilate.uniforms.u_reach, reach);
        }, vao);
        finalEdge = dilateTex;
      }

      // Cleanup + render → default framebuffer
      drawPass(gl, null, W, H, cache.render, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, finalEdge.tex);
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
            `${mode} σ=${sigma}${mode === MODE.FDOG ? " flow" : ""}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  // ── JS fallback ──
  logFilterWasmStatus("Line Art", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const lum = computeLuminance(buf, W, H);
  const lumF = new Float32Array(W * H);
  for (let i = 0; i < lum.length; i++) lumF[i] = lum[i] / 255;

  const gaussBlur = (src: Float32Array, sig: number): Float32Array => {
    const rad = Math.min(MAX_KERNEL, Math.max(1, Math.ceil(sig * 3)));
    const kern = new Float32Array(rad * 2 + 1);
    let kSum = 0;
    for (let i = -rad; i <= rad; i++) { kern[i + rad] = Math.exp(-(i * i) / (2 * sig * sig)); kSum += kern[i + rad]; }
    for (let i = 0; i < kern.length; i++) kern[i] /= kSum;
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let ki = -rad; ki <= rad; ki++) v += src[y * W + Math.max(0, Math.min(W - 1, x + ki))] * kern[ki + rad];
        tmp[y * W + x] = v;
      }
    const out2 = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let ki = -rad; ki <= rad; ki++) v += tmp[Math.max(0, Math.min(H - 1, y + ki)) * W + x] * kern[ki + rad];
        out2[y * W + x] = v;
      }
    return out2;
  };

  let edgeMask: Float32Array;

  if (mode === MODE.SOBEL) {
    const sobelThresh = threshold * 100;
    edgeMask = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const gx = (lumF[y * W + Math.min(W-1, x+1)] - lumF[y * W + Math.max(0, x-1)]) * 255;
        const gy = (lumF[Math.min(H-1, y+1) * W + x] - lumF[Math.max(0, y-1) * W + x]) * 255;
        const mag = Math.sqrt(gx * gx + gy * gy);
        edgeMask[y * W + x] = mag > sobelThresh ? 0 : 1;
      }
  } else {
    const gA = gaussBlur(lumF, sigma);
    const gB = gaussBlur(lumF, sigma * k);
    edgeMask = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const d = gA[i] - gB[i];
      edgeMask[i] = d >= 0 ? 1 : Math.max(0, Math.min(1, 1 + Math.tanh(sharpness * (d + threshold))));
    }
  }

  // Dilate
  let finalEdges = edgeMask;
  if (lineWidth > 1) {
    finalEdges = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let minVal = 1;
        for (let ky = -ceilR; ky <= ceilR; ky++)
          for (let kx = -ceilR; kx <= ceilR; kx++) {
            if (Math.hypot(kx, ky) > reach) continue;
            minVal = Math.min(minVal, edgeMask[Math.max(0, Math.min(H-1, y+ky)) * W + Math.max(0, Math.min(W-1, x+kx))]);
          }
        finalEdges[y * W + x] = minVal;
      }
  }

  // Cleanup
  if (cleanupRadius > 0) {
    const cleaned = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (finalEdges[y * W + x] > 0.5) { cleaned[y * W + x] = 1; continue; }
        let nb = 0;
        for (let ky = -cleanupRadius; ky <= cleanupRadius; ky++)
          for (let kx = -cleanupRadius; kx <= cleanupRadius; kx++) {
            if (kx === 0 && ky === 0) continue;
            if (finalEdges[Math.max(0, Math.min(H-1, y+ky)) * W + Math.max(0, Math.min(W-1, x+kx))] < 0.5) nb++;
          }
        cleaned[y * W + x] = nb >= 2 ? 0 : 1;
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
