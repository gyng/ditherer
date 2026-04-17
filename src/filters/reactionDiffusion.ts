import { ACTION, RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "utils";
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
import { ensureFloatTex, fft2dAvailable } from "gl/fft2d";

// Gray-Scott reaction-diffusion:
//   ∂A/∂t = Da·∇²A − A·B² + F·(1 − A)
//   ∂B/∂t = Db·∇²B + A·B² − (F + k)·B
// With the right F/k you get spots, stripes, labyrinths, coral, mitosis, etc.
// The image's luminance seeds the initial B-species concentration — so
// Turing patterns grow out of the picture rather than from noise.

const SEED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec3 c = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  // Canonical Gray-Scott seed: A ≈ 1 with seeded pockets where B is active.
  // Bright parts of the source map to B=0.25 (the typical active amplitude),
  // dark parts stay near B=0 so patterns emerge out of the lit regions.
  float b = smoothstep(0.35, 0.85, lum) * 0.25;
  float a = 1.0 - b * 2.0;
  fragColor = vec4(a, b, 0.0, 1.0);
}
`;

const STEP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2  u_res;
uniform float u_Da;
uniform float u_Db;
uniform float u_F;
uniform float u_k;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  ivec2 P = ivec2(x, y);
  vec2 c = texelFetch(u_state, P, 0).rg;
  vec2 l = texelFetch(u_state, ivec2(max(int(x) - 1, 0), int(y)), 0).rg;
  vec2 r = texelFetch(u_state, ivec2(min(int(x) + 1, int(u_res.x) - 1), int(y)), 0).rg;
  vec2 d = texelFetch(u_state, ivec2(int(x), max(int(y) - 1, 0)), 0).rg;
  vec2 t = texelFetch(u_state, ivec2(int(x), min(int(y) + 1, int(u_res.y) - 1)), 0).rg;
  // 5-point Laplacian.
  vec2 lap = (l + r + d + t) - 4.0 * c;
  float A = c.r, B = c.g;
  float reaction = A * B * B;
  float dA = u_Da * lap.r - reaction + u_F * (1.0 - A);
  float dB = u_Db * lap.g + reaction - (u_F + u_k) * B;
  fragColor = vec4(A + dA, B + dB, 0.0, 1.0);
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;     // 0 B-field, 1 AxB overlay on source, 2 A−B diverging
uniform vec3  u_lo;
uniform vec3  u_hi;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 ab = texelFetch(u_state, ivec2(x, floor(px.y)), 0).rg;
  vec3 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  vec3 lo = u_lo / 255.0;
  vec3 hi = u_hi / 255.0;

  vec3 rgb;
  if (u_mode == 0) {
    float t = clamp(ab.g * 2.0, 0.0, 1.0);
    rgb = mix(lo, hi, t);
  } else if (u_mode == 1) {
    float t = clamp(ab.g * 3.0, 0.0, 1.0);
    rgb = mix(src, hi, t);
  } else {
    float t = clamp(ab.r - ab.g, 0.0, 1.0);
    rgb = mix(lo, hi, t);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

const PRESET = {
  SPOTS: "SPOTS",
  STRIPES: "STRIPES",
  CORAL: "CORAL",
  MITOSIS: "MITOSIS",
  LABYRINTH: "LABYRINTH",
};
const PRESET_FK: Record<string, [number, number]> = {
  SPOTS: [0.035, 0.065],
  STRIPES: [0.022, 0.051],
  CORAL: [0.055, 0.062],
  MITOSIS: [0.028, 0.062],
  LABYRINTH: [0.039, 0.058],
};

const MODE = { B: "B", OVERLAY: "OVERLAY", DIVERGE: "DIVERGE" };
const MODE_ID: Record<string, number> = { B: 0, OVERLAY: 1, DIVERGE: 2 };

export const optionTypes = {
  preset: {
    type: ENUM,
    options: [
      { name: "Spots", value: PRESET.SPOTS },
      { name: "Stripes", value: PRESET.STRIPES },
      { name: "Coral", value: PRESET.CORAL },
      { name: "Mitosis", value: PRESET.MITOSIS },
      { name: "Labyrinth", value: PRESET.LABYRINTH },
    ],
    default: PRESET.CORAL,
    desc: "F/k parameter preset — each produces a classic Gray-Scott regime"
  },
  steps: { type: RANGE, range: [1, 40], step: 1, default: 10, desc: "Reaction-diffusion steps per frame" },
  mode: {
    type: ENUM,
    options: [
      { name: "B concentration", value: MODE.B },
      { name: "Overlay on source", value: MODE.OVERLAY },
      { name: "A − B diverging", value: MODE.DIVERGE },
    ],
    default: MODE.OVERLAY,
    desc: "How to colour the final state"
  },
  reseed: { type: RANGE, range: [0, 240], step: 1, default: 0, desc: "Reseed B from source every N frames (0 = never)" },
  lo: { type: COLOR, default: [10, 18, 40], desc: "Low-value colour" },
  hi: { type: COLOR, default: [240, 220, 120], desc: "High-value colour" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION, label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    }
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  preset: optionTypes.preset.default,
  steps: optionTypes.steps.default,
  mode: optionTypes.mode.default,
  reseed: optionTypes.reseed.default,
  lo: optionTypes.lo.default,
  hi: optionTypes.hi.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { seed: Program; step: Program; render: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    seed: linkProgram(gl, SEED_FS, ["u_source", "u_res"] as const),
    step: linkProgram(gl, STEP_FS, ["u_state", "u_res", "u_Da", "u_Db", "u_F", "u_k"] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_state", "u_source", "u_res", "u_mode", "u_lo", "u_hi", "u_levels",
    ] as const),
  };
  return _cache;
};

let _stateW = 0, _stateH = 0, _framesSinceSeed = -1;
// Track which float-pool slot holds the newest state across calls, so each
// frame picks up where the last ended rather than drifting one step behind.
let _currentSlot: "A" | "B" = "A";

const reactionDiffusion = (input: any, options = defaults) => {
  const { preset, steps, mode, reseed, lo, hi, palette } = options;
  const W = input.width, H = input.height;

  if (
    glAvailable()
    && fft2dAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "reactionDiffusion:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const stateA = ensureFloatTex(gl, "reactionDiffusion:A", W, H);
      const stateB = ensureFloatTex(gl, "reactionDiffusion:B", W, H);
      if (!stateA || !stateB) {
        logFilterWasmStatus("Reaction-Diffusion", false, "needs WebGL2 + EXT_color_buffer_float");
        return cloneCanvas(input, true);
      }

      const needsSeed = _stateW !== W || _stateH !== H || _framesSinceSeed < 0 ||
        (reseed > 0 && _framesSinceSeed >= reseed);
      if (needsSeed) {
        drawPass(gl, stateA, W, H, cache.seed, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.seed.uniforms.u_source, 0);
          gl.uniform2f(cache.seed.uniforms.u_res, W, H);
        }, vao);
        _stateW = W; _stateH = H; _framesSinceSeed = 0;
        _currentSlot = "A";
      } else {
        _framesSinceSeed++;
      }

      const [F, k] = PRESET_FK[preset] || PRESET_FK.CORAL;
      // Explicit-Euler 5-point Laplacian stability requires Da, Db < 0.25.
      // Canonical Gray-Scott values that reliably produce each regime.
      const Da = 0.2, Db = 0.1;
      let src = _currentSlot === "A" ? stateA : stateB;
      let dst = _currentSlot === "A" ? stateB : stateA;
      const iters = Math.max(1, Math.min(40, Math.round(steps)));
      for (let i = 0; i < iters; i++) {
        drawPass(gl, dst, W, H, cache.step, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform1i(cache.step.uniforms.u_state, 0);
          gl.uniform2f(cache.step.uniforms.u_res, W, H);
          gl.uniform1f(cache.step.uniforms.u_Da, Da);
          gl.uniform1f(cache.step.uniforms.u_Db, Db);
          gl.uniform1f(cache.step.uniforms.u_F, F);
          gl.uniform1f(cache.step.uniforms.u_k, k);
        }, vao);
        [src, dst] = [dst, src];
      }
      _currentSlot = src === stateA ? "A" : "B";

      drawPass(gl, null, W, H, cache.render, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(cache.render.uniforms.u_state, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.render.uniforms.u_source, 1);
        gl.uniform2f(cache.render.uniforms.u_res, W, H);
        gl.uniform1i(cache.render.uniforms.u_mode, MODE_ID[mode] ?? 0);
        gl.uniform3f(cache.render.uniforms.u_lo, lo[0], lo[1], lo[2]);
        gl.uniform3f(cache.render.uniforms.u_hi, hi[0], hi[1], hi[2]);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.render.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Reaction-Diffusion", "WebGL2",
            `${preset} steps=${iters}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Reaction-Diffusion", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Reaction-Diffusion",
  func: reactionDiffusion,
  optionTypes,
  options: defaults,
  defaults,
  description: "Gray-Scott reaction-diffusion seeded from image luminance — spots, stripes, coral, mitosis, labyrinth Turing patterns grow out of the picture over time",
  noWASM: "Iterative on GPU only — CPU would be seconds per frame at 1280×720.",
});
