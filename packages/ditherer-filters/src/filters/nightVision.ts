import { ACTION, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import {
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
import {
  nightVisionIntensifierResponse,
  nightVisionNoiseAmplitude,
} from "./imagingSimulationContracts";
import {
  normalizePaletteOption,
  normalizeRangeOption,
} from "../utils/filterOptions";

export const optionTypes = {
  gain: { type: RANGE, range: [1, 8], step: 0.1, default: 4, desc: "Visible-luminance exposure multiplier before phosphor display" },
  grain: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Equivalent-background and signal-dependent shot noise" },
  bloomRadius: { type: RANGE, range: [0, 8], step: 1, default: 3, desc: "Phosphor glow radius around bright areas" },
  bloomStrength: { type: RANGE, range: [0, 2], step: 0.05, default: 0.6, desc: "Phosphor bloom intensity" },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Circular optical edge darkening" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Noise refresh rate in frames per second" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop the changing intensifier noise pattern",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
      }
    }
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional final palette mapping after the green phosphor response" }
};

export const defaults = {
  gain: optionTypes.gain.default,
  grain: optionTypes.grain.default,
  bloomRadius: optionTypes.bloomRadius.default,
  bloomStrength: optionTypes.bloomStrength.default,
  vignette: optionTypes.vignette.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type NightVisionOptions = Partial<typeof defaults> & {
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

// Amplified luminance + separable box bloom + vignette + green phosphor
// tint. The bloom is computed in two passes (H then V) into float textures.
const NV_AMPLIFY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_gain;

void main() {
  vec4 c = texture(u_source, v_uv);
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float amplified = c.a > 0.0 ? clamp(1.0 - exp(-lum * u_gain), 0.0, 1.0) : 0.0;
  // R remains straight intensity for the source pixel; G carries coverage so
  // only the energy scattered into neighbouring pixels is alpha weighted.
  fragColor = vec4(amplified, c.a, 0.0, 1.0);
}
`;

const NV_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;   // previous pass (amplified or horizontally blurred)
uniform vec2  u_res;
uniform int   u_radius;
uniform vec2  u_axis;        // (1,0) horizontal, (0,1) vertical
uniform float u_threshold;   // bloom threshold (0 = pass through, else subtract)

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float sum = 0.0;
  float count = 0.0;
  for (int k = -8; k <= 8; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(x + float(k) * u_axis.x, 0.0, u_res.x - 1.0);
    float ny = clamp(y + float(k) * u_axis.y, 0.0, u_res.y - 1.0);
    vec2 uv = vec2((nx + 0.5) / u_res.x, 1.0 - (ny + 0.5) / u_res.y);
    vec2 inputValue = texture(u_input, uv).rg;
    float v = inputValue.r;
    if (u_threshold > 0.0) v = max(0.0, v - u_threshold) * inputValue.g;
    sum += v;
    count += 1.0;
  }
  fragColor = vec4(sum / count, 1.0, 0.0, 1.0);
}
`;

const NV_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_lum;      // amplified luminance
uniform sampler2D u_bloom;    // separable-blurred bright regions
uniform sampler2D u_source;   // original alpha
uniform vec2  u_res;
uniform float u_bloomStrength;
uniform float u_grain;
uniform float u_vignette;
uniform float u_seed;

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 uv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float L = texture(u_lum, uv).r;
  float B = texture(u_bloom, uv).r;
  float intensity = clamp(L + B * u_bloomStrength, 0.0, 1.0);

  if (u_grain > 0.0) {
    float noiseAmplitude = u_grain * (0.018 + 0.19 * sqrt(max(intensity, 0.0)));
    float zeroMeanNoise = hash(vec2(x, y), u_seed) +
      hash(vec2(x + 37.0, y + 71.0), u_seed + 19.0) - 1.0;
    intensity += zeroMeanNoise * noiseAmplitude;
  }

  if (u_vignette > 0.0) {
    float cx = u_res.x * 0.5;
    float cy = u_res.y * 0.5;
    float maxR = min(cx, cy);
    float dx = (x - cx) / maxR;
    float dy = (y - cy) / maxR;
    float dist = sqrt(dx * dx + dy * dy);
    float edge = 1.0 - u_vignette * 0.3;
    if (dist > edge) {
      float fade = 1.0 - clamp((dist - edge) / (1.0 - edge + 0.001), 0.0, 1.0);
      intensity *= fade * fade;
    }
    if (dist > 1.0) intensity = 0.0;
  }

  intensity = clamp(intensity, 0.0, 1.0);
  vec3 rgb = vec3(20.0, 255.0, 20.0) * intensity / 255.0;
  fragColor = vec4(rgb, texture(u_source, uv).a);
}
`;

type Cache = { amp: Program; blur: Program; comp: Program; fboA: WebGLFramebuffer | null; texA: WebGLTexture | null; fboB: WebGLFramebuffer | null; texB: WebGLTexture | null; fboC: WebGLFramebuffer | null; texC: WebGLTexture | null; w: number; h: number };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    amp: linkProgram(gl, NV_AMPLIFY_FS, ["u_source", "u_gain"] as const),
    blur: linkProgram(gl, NV_BLUR_FS, ["u_input", "u_res", "u_radius", "u_axis", "u_threshold"] as const),
    comp: linkProgram(gl, NV_COMPOSITE_FS, [
      "u_lum", "u_bloom", "u_source", "u_res", "u_bloomStrength", "u_grain", "u_vignette", "u_seed",
    ] as const),
    fboA: null, texA: null, fboB: null, texB: null, fboC: null, texC: null, w: 0, h: 0,
  };
  return _cache;
};

// Allocate three single-channel float targets: amplified luminance, and
// ping-pong for the two bloom passes.
const ensureTargets = (gl: WebGL2RenderingContext, cache: Cache, w: number, h: number) => {
  if (cache.w === w && cache.h === h && cache.fboA) return;
  const cleanup = (tex: WebGLTexture | null, fbo: WebGLFramebuffer | null) => {
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
  };
  cleanup(cache.texA, cache.fboA);
  cleanup(cache.texB, cache.fboB);
  cleanup(cache.texC, cache.fboC);

  const make = (): [WebGLTexture, WebGLFramebuffer] | null => {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return [tex, fbo];
  };
  const a = make(); const b = make(); const c = make();
  cache.texA = a?.[0] ?? null; cache.fboA = a?.[1] ?? null;
  cache.texB = b?.[0] ?? null; cache.fboB = b?.[1] ?? null;
  cache.texC = c?.[0] ?? null; cache.fboC = c?.[1] ?? null;
  cache.w = w; cache.h = h;
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

const drawTo = (
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null,
  w: number, h: number,
  prog: Program,
  setup: () => void,
  vao: WebGLVertexArrayObject,
) => {
  // Inline drawPass semantics but targeting our own FBO.
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog.prog);
  setup();
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

const nightVision = (
  input: any,
  options: NightVisionOptions = defaults
) => {
  const supplied = { ...defaults, ...options };
  const resolved = {
    ...supplied,
    gain: normalizeRangeOption(supplied.gain, defaults.gain, 1, 8),
    grain: normalizeRangeOption(supplied.grain, defaults.grain, 0, 1),
    bloomRadius: normalizeRangeOption(supplied.bloomRadius, defaults.bloomRadius, 0, 8, true),
    bloomStrength: normalizeRangeOption(supplied.bloomStrength, defaults.bloomStrength, 0, 2),
    vignette: normalizeRangeOption(supplied.vignette, defaults.vignette, 0, 1),
    animSpeed: normalizeRangeOption(supplied.animSpeed, defaults.animSpeed, 1, 30, true),
    palette: normalizePaletteOption(supplied.palette, defaults.palette),
  };
  const {
    gain,
    grain,
    bloomRadius,
    bloomStrength,
    vignette,
    palette
  } = resolved;

  const frameIndex = resolved._frameIndex || 0;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && resolved._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      ensureTargets(gl, cache, W, H);
      if (cache.fboA && cache.fboB && cache.fboC && cache.texA && cache.texB && cache.texC) {
        const sourceTex = ensureTexture(gl, "nightVision:source", W, H);
        uploadSourceTexture(gl, sourceTex, input);

        // 1. Amplify → texA
        drawTo(gl, cache.fboA, W, H, cache.amp, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.amp.uniforms.u_source, 0);
          gl.uniform1f(cache.amp.uniforms.u_gain, gain);
        }, vao);

        const radius = Math.max(0, Math.min(8, Math.round(bloomRadius)));

        // 2. Horizontal bloom pass: texA (with threshold) → texB
        if (radius > 0 && bloomStrength > 0) {
          drawTo(gl, cache.fboB, W, H, cache.blur, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, cache.texA);
            gl.uniform1i(cache.blur.uniforms.u_input, 0);
            gl.uniform2f(cache.blur.uniforms.u_res, W, H);
            gl.uniform1i(cache.blur.uniforms.u_radius, radius);
            gl.uniform2f(cache.blur.uniforms.u_axis, 1, 0);
            gl.uniform1f(cache.blur.uniforms.u_threshold, 0.6);
          }, vao);

          // 3. Vertical bloom pass: texB → texC
          drawTo(gl, cache.fboC, W, H, cache.blur, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, cache.texB);
            gl.uniform1i(cache.blur.uniforms.u_input, 0);
            gl.uniform2f(cache.blur.uniforms.u_res, W, H);
            gl.uniform1i(cache.blur.uniforms.u_radius, radius);
            gl.uniform2f(cache.blur.uniforms.u_axis, 0, 1);
            gl.uniform1f(cache.blur.uniforms.u_threshold, 0.0);
          }, vao);
        } else {
          // Zero bloom by clearing texC.
          gl.bindFramebuffer(gl.FRAMEBUFFER, cache.fboC);
          gl.viewport(0, 0, W, H);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // 4. Composite → default framebuffer (canvas)
        drawTo(gl, null, W, H, cache.comp, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, cache.texA);
          gl.uniform1i(cache.comp.uniforms.u_lum, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, cache.texC);
          gl.uniform1i(cache.comp.uniforms.u_bloom, 1);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.comp.uniforms.u_source, 2);
          gl.uniform2f(cache.comp.uniforms.u_res, W, H);
          gl.uniform1f(cache.comp.uniforms.u_bloomStrength, bloomStrength);
          gl.uniform1f(cache.comp.uniforms.u_grain, grain);
          gl.uniform1f(cache.comp.uniforms.u_vignette, vignette);
          gl.uniform1f(cache.comp.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          const identity = paletteIsIdentity(palette);
          const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
          if (out) {
            logFilterBackend("Night vision", "WebGL2",
              `gain=${gain} bloom=${bloomRadius}${identity ? "" : "+palettePass"}`);
            return out;
          }
        }
      }
    }
  }

  logFilterWasmStatus("Night vision", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const len = buf.length;
  const rng = mulberry32(frameIndex * 7919 + 31337);

  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const alpha = buf[i + 3] / 255;
      const L = alpha > 0
        ? buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722
        : 0;
      const norm = L / 255;
      const amplified = nightVisionIntensifierResponse(norm, gain);
      lum[y * W + x] = amplified;
    }
  }

  const r = bloomRadius;
  let bloomed = lum;

  if (r > 0 && bloomStrength > 0) {
    const bright = new Float32Array(W * H);
    const bloomThreshold = 0.6;
    for (let j = 0; j < W * H; j++) {
      bright[j] = Math.max(0, lum[j] - bloomThreshold) * (buf[j * 4 + 3] / 255);
    }

    const blurH = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0;
        let count = 0;
        for (let kx = -r; kx <= r; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          sum += bright[y * W + nx];
          count++;
        }
        blurH[y * W + x] = sum / count;
      }
    }

    const blurHV = new Float32Array(W * H);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let sum = 0;
        let count = 0;
        for (let ky = -r; ky <= r; ky++) {
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          sum += blurH[ny * W + x];
          count++;
        }
        blurHV[y * W + x] = sum / count;
      }
    }

    bloomed = new Float32Array(W * H);
    for (let j = 0; j < W * H; j++) {
      bloomed[j] = Math.min(1, lum[j] + blurHV[j] * bloomStrength);
    }
  }

  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.min(cx, cy);

  const outBuf = new Uint8ClampedArray(len);
  const pR = 20;
  const pG = 255;
  const pB = 20;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const idx = y * W + x;

      let intensity = bloomed[idx];

      if (grain > 0) {
        const amplitude = nightVisionNoiseAmplitude(intensity, grain);
        intensity += (rng() + rng() - 1) * amplitude;
      }

      if (vignette > 0) {
        const dx = (x - cx) / maxR;
        const dy = (y - cy) / maxR;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const edge = 1 - vignette * 0.3;
        if (dist > edge) {
          const fade = 1 - Math.min(1, (dist - edge) / (1 - edge + 0.001));
          intensity *= fade * fade;
        }
        if (dist > 1) {
          intensity = 0;
        }
      }

      intensity = Math.max(0, Math.min(1, intensity));

      const rr = Math.round(pR * intensity);
      const gg = Math.round(pG * intensity);
      const bb = Math.round(pB * intensity);

      const color = paletteGetColor(palette, rgba(rr, gg, bb, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Night vision",
  func: nightVision,
  options: defaults,
  optionTypes,
  defaults,
  description: "Visible-luminance image-intensifier proxy with MCP-like gain, signal-dependent noise, green phosphor bloom, and tube vignette",
  temporal: true,
});
