import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import {
  cloneCanvas,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
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
  strength: { type: RANGE, range: [0, 3], step: 0.1, default: 1.5, desc: "Intensity of the complementary ghost" },
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 20, desc: "Minimum scene change before a ghost appears" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  strength: optionTypes.strength.default,
  threshold: optionTypes.threshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

type AfterImageOptions = FilterOptionValues & {
  strength?: number;
  threshold?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _webglAcceleration?: boolean;
};

// EMA is a Float32Array maintained by the runtime; upload it as a
// RGBA8-encoded texture (values are already in 0..255 range). Using a
// persistent pooled texture so we don't reallocate every frame.
const AFTER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_ema;
uniform float u_strength;
uniform float u_threshold;

void main() {
  vec4 cur = texture(u_source, v_uv);
  vec4 emaC = texture(u_ema, v_uv);
  vec3 c = cur.rgb * 255.0;
  vec3 e = emaC.rgb * 255.0;

  float lumaLoss = ((e.r - c.r) + (e.g - c.g) + (e.b - c.b)) / 3.0;
  float ghost = 0.0;
  if (lumaLoss > u_threshold) {
    ghost = min(1.0, (lumaLoss - u_threshold) / 80.0) * u_strength * 0.5;
  }
  vec3 inv = vec3(255.0) - e;
  vec3 rgb = clamp(c + (inv - c) * ghost, 0.0, 255.0) / 255.0;
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { ai: Program; emaTex: WebGLTexture | null; emaW: number; emaH: number; emaBuf: Uint8ClampedArray | null };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  const prog = linkProgram(gl, AFTER_FS, [
    "u_source", "u_ema", "u_strength", "u_threshold",
  ] as const);
  _cache = { ai: prog, emaTex: null, emaW: 0, emaH: 0, emaBuf: null };
  return _cache;
};

const ensureEmaTex = (gl: WebGL2RenderingContext, cache: Cache, w: number, h: number) => {
  if (cache.emaTex && cache.emaW === w && cache.emaH === h) return cache.emaTex;
  if (cache.emaTex) gl.deleteTexture(cache.emaTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.emaTex = tex;
  cache.emaW = w;
  cache.emaH = h;
  cache.emaBuf = null;
  return tex;
};

const afterImage = (input: any, options: AfterImageOptions = defaults) => {
  const strength = Number(options.strength ?? defaults.strength);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const ema = options._ema ?? null;
  const W = input.width, H = input.height;

  if (glAvailable() && options._webglAcceleration !== false && ema) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "afterImage:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const emaTex = ensureEmaTex(gl, cache, W, H);
      if (emaTex) {
        // Convert EMA float buffer to Uint8 once per call — reuse scratch.
        if (!cache.emaBuf || cache.emaBuf.length !== ema.length) {
          cache.emaBuf = new Uint8ClampedArray(ema.length);
        }
        const u8 = cache.emaBuf;
        for (let i = 0; i < ema.length; i++) u8[i] = ema[i];

        gl.bindTexture(gl.TEXTURE_2D, emaTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, u8);

        drawPass(gl, null, W, H, cache.ai, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.ai.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, emaTex);
          gl.uniform1i(cache.ai.uniforms.u_ema, 1);
          gl.uniform1f(cache.ai.uniforms.u_strength, strength);
          gl.uniform1f(cache.ai.uniforms.u_threshold, threshold);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          logFilterBackend("After-Image", "WebGL2",
            `strength=${strength} thresh=${threshold}`);
          return rendered;
        }
      }
    }
  }

  logFilterWasmStatus("After-Image", false, !ema ? "no EMA yet" : "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (!ema) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const er = ema[i], eg = ema[i + 1], eb = ema[i + 2];

    const lumaLoss = ((er - r) + (eg - g) + (eb - b)) / 3;
    let ghost = 0;
    if (lumaLoss > threshold) {
      ghost = Math.min(1, (lumaLoss - threshold) / 80) * strength * 0.5;
    }

    const invR = 255 - er;
    const invG = 255 - eg;
    const invB = 255 - eb;

    outBuf[i]     = Math.min(255, Math.max(0, Math.round(r + (invR - r) * ghost)));
    outBuf[i + 1] = Math.min(255, Math.max(0, Math.round(g + (invG - g) * ghost)));
    outBuf[i + 2] = Math.min(255, Math.max(0, Math.round(b + (invB - b) * ghost)));
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "After-Image", func: afterImage, optionTypes, options: defaults, defaults, description: "Complementary-colored ghost when bright objects move away — retinal fatigue simulation" , temporal: true });
