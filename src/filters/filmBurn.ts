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
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Overall burn intensity" },
  warmth: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Warm color bias of the burn" },
  hotspots: { type: RANGE, range: [0, 5], step: 1, default: 2, desc: "Number of concentrated burn areas" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for burn placement" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  warmth: optionTypes.warmth.default,
  hotspots: optionTypes.hotspots.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const FB_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_intensity;
uniform float u_warmth;
uniform int   u_hotspots;
uniform vec3  u_spots[5];   // (x, y, r)
uniform float u_spotInt[5]; // per-spot intensity 0..1
uniform float u_seed;

// Stateless per-pixel grain, seed-folded to match the spirit of mulberry32
// per-pixel initialisation from the JS path.
float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 self = texture(u_source, suv);
  vec3 c = self.rgb * 255.0;

  float edgeDist = min(min(x, u_res.x - x), min(y, u_res.y - y)) / (min(u_res.x, u_res.y) * 0.3);
  float edgeBurn = max(0.0, 1.0 - edgeDist) * u_intensity;

  c.r += edgeBurn * u_warmth * 120.0;
  c.g += edgeBurn * u_warmth * 40.0;
  c.b -= edgeBurn * u_warmth * 30.0;

  float overexpose = edgeBurn * 0.3;
  c.r += overexpose * 80.0;
  c.g += overexpose * 50.0;

  for (int i = 0; i < 5; i++) {
    if (i >= u_hotspots) break;
    vec3 s = u_spots[i];
    float si = u_spotInt[i];
    float dx = x - s.x;
    float dy = y - s.y;
    float dist = sqrt(dx * dx + dy * dy);
    float t = max(0.0, 1.0 - dist / max(s.z, 1.0));
    float hotIntensity = t * t * si * u_intensity;
    c.r += hotIntensity * 200.0;
    c.g += hotIntensity * 120.0;
    c.b += hotIntensity * 60.0;
  }

  float grainAmount = edgeBurn * 20.0;
  if (grainAmount > 0.0) {
    float n = (hash(vec2(x, y), u_seed) - 0.5) * grainAmount;
    c.r += n; c.g += n; c.b += n;
  }

  vec3 rgb = clamp(c, 0.0, 255.0) / 255.0;
  fragColor = vec4(rgb, self.a);
}
`;

type Cache = { fb: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    fb: linkProgram(gl, FB_FS, [
      "u_source", "u_res", "u_intensity", "u_warmth",
      "u_hotspots", "u_spots", "u_spotInt", "u_seed",
    ] as const),
  };
  return _cache;
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const filmBurn = (input: any, options = defaults) => {
  const { intensity, warmth, hotspots, seed, palette } = options;
  const W = input.width, H = input.height;

  // Match the JS RNG call order so hotspot positions carry across backends.
  const rng = mulberry32(seed);
  const spots: { x: number; y: number; r: number; intensity: number }[] = [];
  for (let i = 0; i < hotspots; i++) {
    spots.push({
      x: rng() * W, y: rng() * H,
      r: (0.1 + rng() * 0.3) * Math.max(W, H),
      intensity: 0.3 + rng() * 0.7
    });
  }

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "filmBurn:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const spotArr = new Float32Array(5 * 3);
      const spotIntArr = new Float32Array(5);
      for (let i = 0; i < 5; i++) {
        const s = spots[i];
        if (s) {
          spotArr[i * 3] = s.x;
          spotArr[i * 3 + 1] = H - 1 - s.y;
          spotArr[i * 3 + 2] = s.r;
          spotIntArr[i] = s.intensity;
        }
      }

      drawPass(gl, null, W, H, cache.fb, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.fb.uniforms.u_source, 0);
        gl.uniform2f(cache.fb.uniforms.u_res, W, H);
        gl.uniform1f(cache.fb.uniforms.u_intensity, intensity);
        gl.uniform1f(cache.fb.uniforms.u_warmth, warmth);
        gl.uniform1i(cache.fb.uniforms.u_hotspots, hotspots);
        gl.uniform3fv(cache.fb.uniforms.u_spots, spotArr);
        gl.uniform1fv(cache.fb.uniforms.u_spotInt, spotIntArr);
        gl.uniform1f(cache.fb.uniforms.u_seed, (seed % 1000) * 0.001);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Film Burn", "WebGL2",
            `hotspots=${hotspots}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Film Burn", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];

      const edgeDist = Math.min(x, W - x, y, H - y) / (Math.min(W, H) * 0.3);
      const edgeBurn = Math.max(0, 1 - edgeDist) * intensity;

      r = Math.min(255, Math.round(r + edgeBurn * warmth * 120));
      g = Math.min(255, Math.round(g + edgeBurn * warmth * 40));
      b = Math.max(0, Math.round(b - edgeBurn * warmth * 30));

      const overexpose = edgeBurn * 0.3;
      r = Math.min(255, Math.round(r + overexpose * 80));
      g = Math.min(255, Math.round(g + overexpose * 50));

      for (const spot of spots) {
        const dx = x - spot.x, dy = y - spot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = Math.max(0, 1 - dist / spot.r);
        const hotIntensity = t * t * spot.intensity * intensity;
        r = Math.min(255, Math.round(r + hotIntensity * 200));
        g = Math.min(255, Math.round(g + hotIntensity * 120));
        b = Math.min(255, Math.round(b + hotIntensity * 60));
      }

      const grainAmount = edgeBurn * 20;
      if (grainAmount > 0) {
        const grainRng = mulberry32(x * 31 + y * 997 + seed);
        const n = (grainRng() - 0.5) * grainAmount;
        r = Math.max(0, Math.min(255, Math.round(r + n)));
        g = Math.max(0, Math.min(255, Math.round(g + n)));
        b = Math.max(0, Math.min(255, Math.round(b + n)));
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Film Burn", func: filmBurn, optionTypes, options: defaults, defaults });
