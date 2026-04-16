import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
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
  contrast:   { type: RANGE, range: [1, 5], step: 0.1, default: 3, desc: "Extreme contrast boost" },
  saturation: { type: RANGE, range: [1, 5], step: 0.1, default: 3, desc: "Extreme saturation boost" },
  posterize:  { type: RANGE, range: [4, 64], step: 1, default: 16, desc: "Colour reduction — fewer levels = more banded, fried look" },
  blockiness: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "JPEG-like block artifact intensity — for authentic JPEG artifacts, chain the JPEG Artifact filter after this one" },
  noise:      { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Random noise grain amount" },
  sharpness:  { type: RANGE, range: [0, 3], step: 0.05, default: 1.5, desc: "Over-sharpening intensity" },
  glow:       { type: RANGE, range: [0, 2], step: 0.05, default: 0.6, desc: "Blown-highlight bloom — bright areas bleed and oversaturate" },
  chromaShift:{ type: RANGE, range: [0, 8], step: 0.5, default: 2, desc: "RGB channel misalignment from re-compression" },
  warmth:     { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Warm color cast toward orange/red" },
  animSpeed:  { type: RANGE, range: [1, 30], step: 1, default: 8 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 8); }
    }
  },
  palette:    { type: PALETTE, default: nearest }
};

export const defaults = {
  contrast:   optionTypes.contrast.default,
  saturation: optionTypes.saturation.default,
  posterize:  optionTypes.posterize.default,
  blockiness: optionTypes.blockiness.default,
  noise:      optionTypes.noise.default,
  sharpness:  optionTypes.sharpness.default,
  glow:       optionTypes.glow.default,
  chromaShift:optionTypes.chromaShift.default,
  warmth:     optionTypes.warmth.default,
  animSpeed:  optionTypes.animSpeed.default,
  palette:    { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Single-pass GL shader: chromatic shift → contrast S-curve → HSL
// saturation boost → warmth → posterize → blockiness → unsharp mask →
// glow → noise. All stages fused for zero intermediate readbacks.
const DF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_posterize;
uniform float u_blockiness;
uniform float u_noise;
uniform float u_sharpness;
uniform float u_glow;
uniform float u_chromaShift;
uniform float u_warmth;
uniform float u_seed;
uniform float u_levels;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y)).rgb;
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = ((c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0)) / 6.0;
  else if (mx == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
  else h = ((c.r - c.g) / d + 4.0) / 6.0;
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(float h, float s, float l) {
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0/3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0/3.0));
}

// Core per-pixel processing pipeline.
vec3 processPixel(vec3 c) {
  // S-curve contrast with crushed blacks / blown highlights.
  float cf = u_contrast * 1.2;
  c = (c - 0.5) * cf + 0.5;
  c = mix(c * 0.3, c, step(vec3(0.1), c));
  c = mix(c, 1.0 - (1.0 - c) * 0.3, step(vec3(0.9), c));
  c = clamp(c, 0.0, 1.0);

  // Saturation boost.
  vec3 hsl = rgb2hsl(c);
  hsl.y = clamp(hsl.y * u_saturation, 0.0, 1.0);
  c = hsl2rgb(hsl.x, hsl.y, hsl.z);

  // Warm cast.
  c.r = clamp(c.r + u_warmth * (60.0 / 255.0), 0.0, 1.0);
  c.g = clamp(c.g + u_warmth * (20.0 / 255.0), 0.0, 1.0);
  c.b = clamp(c.b - u_warmth * (30.0 / 255.0), 0.0, 1.0);

  // Posterize — banded colour reduction.
  if (u_posterize < 63.5) {
    float q = max(1.0, u_posterize - 1.0);
    c = floor(c * q + 0.5) / q;
  }

  return c;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Chromatic shift: sample R/G/B from slightly offset positions.
  vec3 src;
  if (u_chromaShift > 0.0) {
    float off = u_chromaShift;
    src.r = samplePx(x - off, y).r;
    src.g = samplePx(x, y).g;
    src.b = samplePx(x + off, y).b;
  } else {
    src = samplePx(x, y);
  }

  vec3 c = processPixel(src);

  // Blockiness: blend toward 8×8 block centre.
  if (u_blockiness > 0.0) {
    float bx = floor(x / 8.0) * 8.0 + 3.5;
    float by = floor(y / 8.0) * 8.0 + 3.5;
    vec3 blockAvg = processPixel(samplePx(bx, by));
    c = mix(c, blockAvg, u_blockiness);
  }

  // Unsharp mask: over-sharpen via 3×3 box blur.
  if (u_sharpness > 0.0) {
    vec3 blurred = vec3(0.0);
    for (int ky = -1; ky <= 1; ky++)
      for (int kx = -1; kx <= 1; kx++)
        blurred += processPixel(samplePx(x + float(kx), y + float(ky)));
    blurred /= 9.0;
    c = clamp(c + u_sharpness * (c - blurred), 0.0, 1.0);
  }

  // Bloom / glow: bright areas bleed outward and oversaturate.
  if (u_glow > 0.0) {
    float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    // Self-glow: push already-bright pixels toward white, tinted by their
    // own colour, for the classic blown-out deep-fried highlight halo.
    float glowAmount = smoothstep(0.45, 0.95, lum) * u_glow;
    c = clamp(c + c * glowAmount, 0.0, 1.0);
    // Neighbourhood bleed: average 4 diagonal samples for a cheap cross-glow.
    vec3 cross = (
      processPixel(samplePx(x - 2.0, y - 2.0)) +
      processPixel(samplePx(x + 2.0, y - 2.0)) +
      processPixel(samplePx(x - 2.0, y + 2.0)) +
      processPixel(samplePx(x + 2.0, y + 2.0))
    ) * 0.25;
    float crossLum = 0.299 * cross.r + 0.587 * cross.g + 0.114 * cross.b;
    float crossGlow = smoothstep(0.5, 1.0, crossLum) * u_glow * 0.4;
    c = clamp(c + cross * crossGlow, 0.0, 1.0);
  }

  // Noise.
  if (u_noise > 0.0) {
    float n = (hash(vec2(x, y), u_seed) - 0.5) * u_noise;
    c = clamp(c + vec3(n), 0.0, 1.0);
  }

  if (u_levels > 1.5) {
    float q2 = u_levels - 1.0;
    c = floor(c * q2 + 0.5) / q2;
  }
  fragColor = vec4(c, 1.0);
}
`;

type Cache = { df: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    df: linkProgram(gl, DF_FS, [
      "u_source", "u_res", "u_contrast", "u_saturation", "u_posterize",
      "u_blockiness", "u_noise", "u_sharpness", "u_glow", "u_chromaShift",
      "u_warmth", "u_seed", "u_levels",
    ] as const),
  };
  return _cache;
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const clamp = (v: number) => Math.max(0, Math.min(255, v));

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 :
    max === g ? ((b - r) / d + 2) / 6 :
    ((r - g) / d + 4) / 6;
  return [h, s, l];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
};

const deepFry = (input: any, options = defaults) => {
  const { contrast, saturation, posterize, blockiness, noise, sharpness, glow, chromaShift, warmth, palette } = options;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "deepFry:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.df, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.df.uniforms.u_source, 0);
        gl.uniform2f(cache.df.uniforms.u_res, W, H);
        gl.uniform1f(cache.df.uniforms.u_contrast, contrast);
        gl.uniform1f(cache.df.uniforms.u_saturation, saturation);
        gl.uniform1f(cache.df.uniforms.u_posterize, posterize);
        gl.uniform1f(cache.df.uniforms.u_blockiness, blockiness);
        gl.uniform1f(cache.df.uniforms.u_noise, noise);
        gl.uniform1f(cache.df.uniforms.u_sharpness, sharpness);
        gl.uniform1f(cache.df.uniforms.u_glow, glow);
        gl.uniform1f(cache.df.uniforms.u_chromaShift, chromaShift);
        gl.uniform1f(cache.df.uniforms.u_warmth, warmth);
        gl.uniform1f(cache.df.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.df.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Deep fry", "WebGL2",
            `c=${contrast} s=${saturation}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Deep fry", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const rng = mulberry32(frameIndex * 7919 + 31337);

  const work = new Float32Array(buf.length);
  // Chromatic shift: offset R and B channels horizontally.
  if (chromaShift > 0) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const rI = getBufferIndex(Math.max(0, Math.min(W - 1, x - Math.round(chromaShift))), y, W);
      const bI = getBufferIndex(Math.max(0, Math.min(W - 1, x + Math.round(chromaShift))), y, W);
      work[i] = buf[rI]; work[i + 1] = buf[i + 1]; work[i + 2] = buf[bI + 2]; work[i + 3] = buf[i + 3];
    }
  } else {
    for (let i = 0; i < buf.length; i++) work[i] = buf[i];
  }

  const contrastFactor = contrast * 1.2;
  for (let i = 0; i < work.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = work[i + c] / 255;
      v = (v - 0.5) * contrastFactor + 0.5;
      v = v < 0.1 ? v * 0.3 : v;
      v = v > 0.9 ? 1 - (1 - v) * 0.3 : v;
      work[i + c] = clamp(v * 255);
    }
  }

  for (let i = 0; i < work.length; i += 4) {
    const [h, s, l] = rgbToHsl(work[i], work[i + 1], work[i + 2]);
    const [r, g, b] = hslToRgb(h, Math.min(1, s * saturation), l);
    work[i] = r; work[i + 1] = g; work[i + 2] = b;
  }

  if (warmth > 0) {
    for (let i = 0; i < work.length; i += 4) {
      work[i]     = clamp(work[i] + warmth * 60);
      work[i + 1] = clamp(work[i + 1] + warmth * 20);
      work[i + 2] = clamp(work[i + 2] - warmth * 30);
    }
  }

  // Posterize
  if (posterize < 64) {
    const step = 255 / Math.max(1, posterize - 1);
    for (let i = 0; i < work.length; i += 4) {
      work[i]     = clamp(Math.round(Math.round(work[i] / step) * step));
      work[i + 1] = clamp(Math.round(Math.round(work[i + 1] / step) * step));
      work[i + 2] = clamp(Math.round(Math.round(work[i + 2] / step) * step));
    }
  }

  if (blockiness > 0) {
    for (let by = 0; by < H; by += 8) {
      for (let bx = 0; bx < W; bx += 8) {
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        const bw = Math.min(8, W - bx), bh = Math.min(8, H - by);
        for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) {
          const idx = getBufferIndex(bx + dx, by + dy, W);
          sumR += work[idx]; sumG += work[idx + 1]; sumB += work[idx + 2]; count++;
        }
        const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
        for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) {
          const idx = getBufferIndex(bx + dx, by + dy, W);
          work[idx]     = work[idx]     * (1 - blockiness) + avgR * blockiness;
          work[idx + 1] = work[idx + 1] * (1 - blockiness) + avgG * blockiness;
          work[idx + 2] = work[idx + 2] * (1 - blockiness) + avgB * blockiness;
        }
      }
    }
  }

  if (sharpness > 0) {
    const blurred = new Float32Array(work.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
        const ki = getBufferIndex(Math.max(0, Math.min(W - 1, x + kx)), Math.max(0, Math.min(H - 1, y + ky)), W);
        sr += work[ki]; sg += work[ki + 1]; sb += work[ki + 2]; count++;
      }
      const i = getBufferIndex(x, y, W);
      blurred[i] = sr / count; blurred[i + 1] = sg / count; blurred[i + 2] = sb / count;
    }
    for (let i = 0; i < work.length; i += 4) {
      work[i]     = clamp(work[i]     + sharpness * (work[i]     - blurred[i]));
      work[i + 1] = clamp(work[i + 1] + sharpness * (work[i + 1] - blurred[i + 1]));
      work[i + 2] = clamp(work[i + 2] + sharpness * (work[i + 2] - blurred[i + 2]));
    }
  }

  // Glow: bright pixels self-illuminate.
  if (glow > 0) {
    for (let i = 0; i < work.length; i += 4) {
      const lumV = 0.299 * work[i] + 0.587 * work[i + 1] + 0.114 * work[i + 2];
      const t = lumV / 255;
      if (t > 0.45) {
        const g2 = Math.min(1, (t - 0.45) / 0.5) * glow;
        work[i]     = clamp(work[i] + work[i] / 255 * g2 * 255);
        work[i + 1] = clamp(work[i + 1] + work[i + 1] / 255 * g2 * 255);
        work[i + 2] = clamp(work[i + 2] + work[i + 2] / 255 * g2 * 255);
      }
    }
  }

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = getBufferIndex(x, y, W);
    let r = work[i], g = work[i + 1], b = work[i + 2];
    if (noise > 0) {
      const n = (rng() - 0.5) * noise * 255;
      r = clamp(r + n); g = clamp(g + n); b = clamp(b + n);
    }
    const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
    fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Deep fry",
  func: deepFry,
  options: defaults,
  optionTypes,
  defaults
});
