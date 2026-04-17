import { ACTION, RANGE, ENUM, PALETTE } from "constants/controlTypes";
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

// Simplified Stam-style stable fluids. Two RG32F state textures:
//   density: R=density, G=unused
//   velocity: RG=(vx, vy)
// Per step: advect density by velocity, advect velocity by itself,
// apply a small viscous smoothing. We skip the divergence-projection step
// — it's audible in "true" simulation quality but for a visual effect the
// advection loop alone gives the classic Stam swirl look. Each frame the
// image gradient re-injects a velocity impulse, so the fluid keeps
// flowing along the picture's edges.

const SEED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_target;   // 0 = density, 1 = velocity

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  if (u_target == 0) {
    vec3 c = texture(u_source, suv).rgb;
    fragColor = vec4(lum(c), 0.0, 0.0, 1.0);
  } else {
    vec2 onePx = 1.0 / u_res;
    float l = lum(texture(u_source, suv - vec2(onePx.x, 0.0)).rgb);
    float r = lum(texture(u_source, suv + vec2(onePx.x, 0.0)).rgb);
    float d = lum(texture(u_source, suv - vec2(0.0, onePx.y)).rgb);
    float t = lum(texture(u_source, suv + vec2(0.0, onePx.y)).rgb);
    // Rotate gradient 90° to get flow tangent to edges (curl-like).
    fragColor = vec4(-(t - d), r - l, 0.0, 1.0);
  }
}
`;

const STEP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_field;   // field being advected (density or velocity)
uniform sampler2D u_vel;     // velocity field
uniform sampler2D u_source;  // original image
uniform vec2  u_res;
uniform float u_dt;
uniform float u_viscosity;
uniform float u_forcing;     // how strongly each step re-injects image gradient into velocity
uniform int   u_target;      // 0 density, 1 velocity

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  vec2 uv = (vec2(x, y) + 0.5) / u_res;

  // Semi-Lagrangian advection: sample velocity here, trace back by -v·dt.
  vec2 v = texelFetch(u_vel, ivec2(x, y), 0).rg;
  vec2 backUV = uv - v * u_dt / u_res;
  backUV = clamp(backUV, vec2(0.0), vec2(1.0));
  vec4 advected = texture(u_field, backUV);

  vec4 result;
  if (u_target == 0) {
    // Density: small dissipation + a touch of the source to keep the
    // "smoke trails" from vanishing.
    float src = lum(texture(u_source, vec2(uv.x, 1.0 - uv.y)).rgb);
    result = vec4(mix(advected.r, src, 0.02) * 0.997, 0.0, 0.0, 1.0);
  } else {
    // Velocity: advect + viscous damping + forcing from the image gradient.
    vec2 onePx = 1.0 / u_res;
    vec2 suv = vec2(uv.x, 1.0 - uv.y);
    float l = lum(texture(u_source, suv - vec2(onePx.x, 0.0)).rgb);
    float r = lum(texture(u_source, suv + vec2(onePx.x, 0.0)).rgb);
    float d = lum(texture(u_source, suv - vec2(0.0, onePx.y)).rgb);
    float t = lum(texture(u_source, suv + vec2(0.0, onePx.y)).rgb);
    vec2 force = vec2(-(t - d), r - l) * u_forcing;
    vec2 vel = advected.rg * (1.0 - u_viscosity) + force * u_dt;
    // Clamp velocity to keep the CFL-ish condition reasonable.
    vel = clamp(vel, vec2(-40.0), vec2(40.0));
    result = vec4(vel, 0.0, 1.0);
  }
  fragColor = result;
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_density;
uniform sampler2D u_vel;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;     // 0 density over source, 1 velocity field, 2 smoke only
uniform float u_amount;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  ivec2 P = ivec2(x, floor(px.y));
  float dens = texelFetch(u_density, P, 0).r;
  vec2 vel = texelFetch(u_vel, P, 0).rg;
  vec3 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;

  vec3 rgb;
  if (u_mode == 0) {
    rgb = mix(src, vec3(dens), u_amount);
  } else if (u_mode == 1) {
    float a = atan(vel.y, vel.x);
    float m = clamp(length(vel) * 0.1, 0.0, 1.0);
    vec3 hue = 0.5 + 0.5 * cos(a + vec3(0.0, 2.094, 4.188));
    rgb = mix(vec3(0.08), hue, m);
  } else {
    rgb = vec3(clamp(dens, 0.0, 1.0));
  }
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

const MODE = { OVERLAY: "OVERLAY", FIELD: "FIELD", SMOKE: "SMOKE" };
const MODE_ID: Record<string, number> = { OVERLAY: 0, FIELD: 1, SMOKE: 2 };

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Smoke over source", value: MODE.OVERLAY },
      { name: "Velocity field", value: MODE.FIELD },
      { name: "Smoke only", value: MODE.SMOKE },
    ],
    default: MODE.OVERLAY,
    desc: "What to render"
  },
  steps: { type: RANGE, range: [1, 20], step: 1, default: 3, desc: "Advection steps per frame — more = faster flow" },
  dt: { type: RANGE, range: [0.1, 8], step: 0.1, default: 2.0, desc: "Time step — larger = more violent motion" },
  viscosity: { type: RANGE, range: [0, 0.2], step: 0.005, default: 0.02, desc: "Damping applied to velocity per step" },
  forcing: { type: RANGE, range: [0, 40], step: 0.5, default: 8.0, desc: "How strongly the image gradient re-injects flow each step" },
  amount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Blend smoke over source (overlay mode)" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION, label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    }
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  mode: optionTypes.mode.default,
  steps: optionTypes.steps.default,
  dt: optionTypes.dt.default,
  viscosity: optionTypes.viscosity.default,
  forcing: optionTypes.forcing.default,
  amount: optionTypes.amount.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { seed: Program; step: Program; render: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    seed: linkProgram(gl, SEED_FS, ["u_source", "u_res", "u_target"] as const),
    step: linkProgram(gl, STEP_FS, [
      "u_field", "u_vel", "u_source", "u_res", "u_dt",
      "u_viscosity", "u_forcing", "u_target",
    ] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_density", "u_vel", "u_source", "u_res", "u_mode", "u_amount", "u_levels",
    ] as const),
  };
  return _cache;
};

let _stateW = 0, _stateH = 0, _seeded = false;
let _densSlot: "A" | "B" = "A", _velSlot: "A" | "B" = "A";

const stableFluids = (input: any, options = defaults) => {
  const { mode, steps, dt, viscosity, forcing, amount, palette } = options;
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
      const sourceTex = ensureTexture(gl, "stableFluids:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const densA = ensureFloatTex(gl, "stableFluids:densA", W, H);
      const densB = ensureFloatTex(gl, "stableFluids:densB", W, H);
      const velA = ensureFloatTex(gl, "stableFluids:velA", W, H);
      const velB = ensureFloatTex(gl, "stableFluids:velB", W, H);
      if (!densA || !densB || !velA || !velB) {
        logFilterWasmStatus("Stable Fluids", false, "needs WebGL2 + EXT_color_buffer_float");
        return cloneCanvas(input, true);
      }

      if (_stateW !== W || _stateH !== H || !_seeded) {
        drawPass(gl, densA, W, H, cache.seed, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.seed.uniforms.u_source, 0);
          gl.uniform2f(cache.seed.uniforms.u_res, W, H);
          gl.uniform1i(cache.seed.uniforms.u_target, 0);
        }, vao);
        drawPass(gl, velA, W, H, cache.seed, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.seed.uniforms.u_source, 0);
          gl.uniform2f(cache.seed.uniforms.u_res, W, H);
          gl.uniform1i(cache.seed.uniforms.u_target, 1);
        }, vao);
        _stateW = W; _stateH = H; _seeded = true;
        _densSlot = "A"; _velSlot = "A";
      }

      const iters = Math.max(1, Math.min(20, Math.round(steps)));
      let dSrc = _densSlot === "A" ? densA : densB;
      let dDst = _densSlot === "A" ? densB : densA;
      let vSrc = _velSlot === "A" ? velA : velB;
      let vDst = _velSlot === "A" ? velB : velA;

      for (let i = 0; i < iters; i++) {
        // Velocity update first so density reads the newest velocity.
        drawPass(gl, vDst, W, H, cache.step, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, vSrc.tex);
          gl.uniform1i(cache.step.uniforms.u_field, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, vSrc.tex);
          gl.uniform1i(cache.step.uniforms.u_vel, 1);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.step.uniforms.u_source, 2);
          gl.uniform2f(cache.step.uniforms.u_res, W, H);
          gl.uniform1f(cache.step.uniforms.u_dt, dt);
          gl.uniform1f(cache.step.uniforms.u_viscosity, viscosity);
          gl.uniform1f(cache.step.uniforms.u_forcing, forcing);
          gl.uniform1i(cache.step.uniforms.u_target, 1);
        }, vao);
        [vSrc, vDst] = [vDst, vSrc];

        drawPass(gl, dDst, W, H, cache.step, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, dSrc.tex);
          gl.uniform1i(cache.step.uniforms.u_field, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, vSrc.tex);
          gl.uniform1i(cache.step.uniforms.u_vel, 1);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.step.uniforms.u_source, 2);
          gl.uniform2f(cache.step.uniforms.u_res, W, H);
          gl.uniform1f(cache.step.uniforms.u_dt, dt);
          gl.uniform1f(cache.step.uniforms.u_viscosity, viscosity);
          gl.uniform1f(cache.step.uniforms.u_forcing, forcing);
          gl.uniform1i(cache.step.uniforms.u_target, 0);
        }, vao);
        [dSrc, dDst] = [dDst, dSrc];
      }
      _densSlot = dSrc === densA ? "A" : "B";
      _velSlot = vSrc === velA ? "A" : "B";

      drawPass(gl, null, W, H, cache.render, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dSrc.tex);
        gl.uniform1i(cache.render.uniforms.u_density, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, vSrc.tex);
        gl.uniform1i(cache.render.uniforms.u_vel, 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.render.uniforms.u_source, 2);
        gl.uniform2f(cache.render.uniforms.u_res, W, H);
        gl.uniform1i(cache.render.uniforms.u_mode, MODE_ID[mode] ?? 0);
        gl.uniform1f(cache.render.uniforms.u_amount, amount);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.render.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Stable Fluids", "WebGL2",
            `${mode} steps=${iters} dt=${dt}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }
  logFilterWasmStatus("Stable Fluids", false, "needs WebGL2 + EXT_color_buffer_float");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Stable Fluids",
  func: stableFluids,
  optionTypes,
  options: defaults,
  defaults,
  description: "Stam-style semi-Lagrangian fluid advection — smoke flows along the image's edges, picking up gradients as forcing terms each frame",
  noWASM: "Semi-Lagrangian advection is textures all the way down.",
});
