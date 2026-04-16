import { RANGE, PALETTE } from "constants/controlTypes";
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

export const optionTypes = {
  contrast: { type: RANGE, range: [1, 5], step: 0.1, default: 2.5, desc: "Copy contrast — higher = blown-out whites" },
  edgeDarken: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Edge darkening around details" },
  speckle: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Random toner speckle amount" },
  generationLoss: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Quality degradation from copy-of-a-copy" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  contrast: optionTypes.contrast.default,
  edgeDarken: optionTypes.edgeDarken.default,
  speckle: optionTypes.speckle.default,
  generationLoss: optionTypes.generationLoss.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const PC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_contrast;
uniform float u_edgeDarken;
uniform float u_speckle;
uniform float u_generationLoss;
uniform float u_seed;
uniform float u_levels;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float lum(vec3 c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * 255.0; }

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
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 self = texture(u_source, suv);

  float l = lum(self.rgb) / 255.0;
  l = pow(max(l, 0.0), 1.0 / u_contrast);
  l = (l - 0.5) * u_contrast + 0.5;
  l = clamp(l, 0.0, 1.0);

  if (u_edgeDarken > 0.0 && x > 0.0 && x < u_res.x - 1.0 && y > 0.0 && y < u_res.y - 1.0) {
    float a = lum(samplePx(x - 1.0, y - 1.0));
    float b = lum(samplePx(x,       y - 1.0));
    float c = lum(samplePx(x + 1.0, y - 1.0));
    float d = lum(samplePx(x - 1.0, y      ));
    float f = lum(samplePx(x + 1.0, y      ));
    float g = lum(samplePx(x - 1.0, y + 1.0));
    float h = lum(samplePx(x,       y + 1.0));
    float iv = lum(samplePx(x + 1.0, y + 1.0));
    float gx = -a - 2.0 * d - g + c + 2.0 * f + iv;
    float gy = -a - 2.0 * b - c + g + 2.0 * h + iv;
    float edge = sqrt(gx * gx + gy * gy) / 1440.0;
    l = max(0.0, l - edge * u_edgeDarken);
  }

  if (u_speckle > 0.0) {
    // The JS path gates speckle per pixel by an RNG draw (≈speckle*0.3
    // probability); approximate that with a second positional hash.
    float gate = hash(vec2(x + 17.0, y + 31.0), u_seed);
    if (gate < u_speckle * 0.3) {
      l = clamp(l + (hash(vec2(x, y), u_seed + 2.0) - 0.5) * u_speckle, 0.0, 1.0);
    }
  }

  if (u_generationLoss > 0.0) {
    float steps = max(2.0, floor(32.0 * (1.0 - u_generationLoss) + 0.5));
    l = floor(l * steps + 0.5) / steps;
  }

  vec3 rgb = vec3(l);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), self.a);
}
`;

type Cache = { pc: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    pc: linkProgram(gl, PC_FS, [
      "u_source", "u_res", "u_contrast", "u_edgeDarken",
      "u_speckle", "u_generationLoss", "u_seed", "u_levels",
    ] as const),
  };
  return _cache;
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const photocopier = (input: any, options = defaults) => {
  const { contrast, edgeDarken, speckle, generationLoss, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "photocopier:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.pc, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.pc.uniforms.u_source, 0);
        gl.uniform2f(cache.pc.uniforms.u_res, W, H);
        gl.uniform1f(cache.pc.uniforms.u_contrast, contrast);
        gl.uniform1f(cache.pc.uniforms.u_edgeDarken, edgeDarken);
        gl.uniform1f(cache.pc.uniforms.u_speckle, speckle);
        gl.uniform1f(cache.pc.uniforms.u_generationLoss, generationLoss);
        gl.uniform1f(cache.pc.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.pc.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Photocopier", "WebGL2",
            `contrast=${contrast}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Photocopier", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 31337);

  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let l = lum[y * W + x] / 255;

      l = Math.pow(l, 1 / contrast);
      l = (l - 0.5) * contrast + 0.5;
      l = Math.max(0, Math.min(1, l));

      if (edgeDarken > 0 && x > 0 && x < W - 1 && y > 0 && y < H - 1) {
        const gx = -lum[(y - 1) * W + (x - 1)] - 2 * lum[y * W + (x - 1)] - lum[(y + 1) * W + (x - 1)]
                  + lum[(y - 1) * W + (x + 1)] + 2 * lum[y * W + (x + 1)] + lum[(y + 1) * W + (x + 1)];
        const gy = -lum[(y - 1) * W + (x - 1)] - 2 * lum[(y - 1) * W + x] - lum[(y - 1) * W + (x + 1)]
                  + lum[(y + 1) * W + (x - 1)] + 2 * lum[(y + 1) * W + x] + lum[(y + 1) * W + (x + 1)];
        const edge = Math.sqrt(gx * gx + gy * gy) / 1440;
        l -= edge * edgeDarken;
        l = Math.max(0, l);
      }

      if (speckle > 0 && rng() < speckle * 0.3) {
        l += (rng() - 0.5) * speckle;
        l = Math.max(0, Math.min(1, l));
      }

      if (generationLoss > 0) {
        const steps = Math.max(2, Math.round(32 * (1 - generationLoss)));
        l = Math.round(l * steps) / steps;
      }

      const v = Math.round(l * 255);
      const color = paletteGetColor(palette, rgba(v, v, v, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Photocopier", func: photocopier, optionTypes, options: defaults, defaults });
