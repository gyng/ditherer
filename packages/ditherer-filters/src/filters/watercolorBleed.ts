import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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
  type TexEntry,
} from "../gl/index";

// Bounded watercolor stylization: iterative pigment-field diffusion with
// edge deposition and a paper texture. This deliberately does not claim to be
// a shallow-water solver; there is no independent water mask or deposited-
// pigment layer in a source photograph.

const DIFFUSE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_prev;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_flow;       // how much pigment diffuses per step
uniform float u_edgeBloom;  // edge-ring darkening strength
uniform float u_wetness;    // how strongly wet regions bleed into dry

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = floor(px.y);
  vec2 onePx = 1.0 / u_res;
  vec2 uv = (vec2(x, y) + 0.5) / u_res;

  vec4 c = texture(u_prev, uv);
  vec4 l = texture(u_prev, uv - vec2(onePx.x, 0.0));
  vec4 r = texture(u_prev, uv + vec2(onePx.x, 0.0));
  vec4 d = texture(u_prev, uv - vec2(0.0, onePx.y));
  vec4 t = texture(u_prev, uv + vec2(0.0, onePx.y));
  vec4 ld = texture(u_prev, uv - onePx);
  vec4 lt = texture(u_prev, uv + vec2(-onePx.x, onePx.y));
  vec4 rd = texture(u_prev, uv + vec2(onePx.x, -onePx.y));
  vec4 rt = texture(u_prev, uv + onePx);
  // Darker source values approximate higher pigment load, not water content.
  // Wetness controls how strongly that source-derived load changes mobility.
  float cL = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float wet = mix(1.0, 1.0 - cL, u_wetness);

  // Isotropic eight-neighbour migration. Cardinal samples receive twice the
  // weight of diagonals to reduce grid-aligned diffusion artifacts.
  vec4 avg = ((l + r + d + t) * 2.0 + ld + lt + rd + rt) / 12.0;
  vec4 diff = avg - c;
  vec4 migrated = c + diff * u_flow * wet;

  // Edge deposition follows pigment concentration (inverse luminance), not
  // one arbitrary RGB channel, so saturated washes receive equal treatment.
  float avgL = dot(avg.rgb, vec3(0.2126, 0.7152, 0.0722));
  float pigmentPile = max(0.0, (1.0 - cL) - (1.0 - avgL));
  float edge = clamp(pigmentPile * 4.0, 0.0, 1.0);
  migrated.rgb *= 1.0 - edge * u_edgeBloom * 0.4;
  fragColor = vec4(clamp(migrated.rgb, 0.0, 1.0), texture(u_source, uv).a);
}
`;

const PAPER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pigment;
uniform vec2  u_res;
uniform float u_paper;
uniform float u_levels;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 smoothF = f * f * (3.0 - 2.0 * f);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec4 pig = texelFetch(u_pigment, ivec2(x, floor(px.y)), 0);
  vec3 rgb = pig.rgb;
  if (u_paper > 0.0) {
    vec2 paperPx = vec2(x, y);
    float fine = valueNoise(vec2(paperPx.x * 0.72, paperPx.y * 0.28));
    float coarse = valueNoise(paperPx * 0.065);
    float fiber = valueNoise(vec2(paperPx.x * 0.9, paperPx.y * 0.035));
    float grain = (fine - 0.5) * 0.10
                + (coarse - 0.5) * 0.18
                + (fiber - 0.5) * 0.08;
    rgb = rgb * (1.0 + grain * u_paper);
    // Warm paper tint blends in proportionally.
    vec3 paperTint = vec3(248.0, 243.0, 226.0) / 255.0;
    rgb = mix(rgb, paperTint * max(max(rgb.r, rgb.g), rgb.b), u_paper * 0.18);
  }
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, pig.a);
}
`;

export const optionTypes = {
  iterations: {
    type: RANGE,
    range: [1, 32],
    step: 1,
    default: 14,
    desc: "Pigment-diffusion iterations — more = softer bleed",
  },
  flow: {
    type: RANGE,
    range: [0, 0.6],
    step: 0.02,
    default: 0.25,
    desc: "Per-step diffusion amount — higher = more watery",
  },
  wetness: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.7,
    desc: "How strongly source-derived pigment load modulates mobility — an artistic wetness approximation",
  },
  edgeBloom: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.5,
    desc: "Luminance-based pigment deposition along wash edges",
  },
  paperTexture: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.3,
    desc: "Visible paper grain",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  iterations: optionTypes.iterations.default,
  flow: optionTypes.flow.default,
  wetness: optionTypes.wetness.default,
  edgeBloom: optionTypes.edgeBloom.default,
  paperTexture: optionTypes.paperTexture.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Cache = { diffuse: Program; paper: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    diffuse: linkProgram(gl, DIFFUSE_FS, [
      "u_prev",
      "u_source",
      "u_res",
      "u_flow",
      "u_edgeBloom",
      "u_wetness",
    ] as const),
    paper: linkProgram(gl, PAPER_FS, ["u_pigment", "u_res", "u_paper", "u_levels"] as const),
  };
  return _cache;
};

const watercolorBleed = (input: any, options: Partial<typeof defaults> = defaults) => {
  const {
    iterations = defaults.iterations,
    flow = defaults.flow,
    wetness = defaults.wetness,
    edgeBloom = defaults.edgeBloom,
    paperTexture = defaults.paperTexture,
    palette = defaults.palette,
  } = options;
  const W = input.width,
    H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex: TexEntry = ensureTexture(gl, "watercolorBleed:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      // Two RGBA8 ping-pong buffers. RGBA8 is fine here — we're smoothing.
      const bufA: TexEntry = ensureTexture(gl, "watercolorBleed:A", W, H);
      const bufB: TexEntry = ensureTexture(gl, "watercolorBleed:B", W, H);

      // Copy source → A via a passthrough: easiest path is one iteration
      // where flow=0, giving us c.rgb unchanged. We just bind source as prev.
      let src = sourceTex,
        dst = bufA;
      const iters = Math.max(1, Math.min(32, Math.round(iterations)));
      for (let i = 0; i < iters; i++) {
        drawPass(
          gl,
          dst,
          W,
          H,
          cache.diffuse,
          () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, src.tex);
            gl.uniform1i(cache.diffuse.uniforms.u_prev, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
            gl.uniform1i(cache.diffuse.uniforms.u_source, 1);
            gl.uniform2f(cache.diffuse.uniforms.u_res, W, H);
            gl.uniform1f(cache.diffuse.uniforms.u_flow, flow);
            // Edge deposition is a total-process control, not a per-timestep
            // multiplier. Normalize it so extra diffusion steps soften the wash
            // without exponentially re-darkening the same quantization residue.
            gl.uniform1f(cache.diffuse.uniforms.u_edgeBloom, edgeBloom / iters);
            gl.uniform1f(cache.diffuse.uniforms.u_wetness, wetness);
          },
          vao,
        );
        // After first pass, ping-pong between A and B.
        if (i === 0) {
          src = bufA;
          dst = bufB;
        } else {
          [src, dst] = [dst, src];
        }
      }

      drawPass(
        gl,
        null,
        W,
        H,
        cache.paper,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform1i(cache.paper.uniforms.u_pigment, 0);
          gl.uniform2f(cache.paper.uniforms.u_res, W, H);
          gl.uniform1f(cache.paper.uniforms.u_paper, paperTexture);
          const identity = paletteIsIdentity(palette);
          const pOpts = (palette as { options?: { levels?: number } }).options;
          gl.uniform1f(cache.paper.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend(
            "Watercolor Bleed",
            "WebGL2",
            `iters=${iters} flow=${flow}${identity ? "" : "+palettePass"}`,
          );
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Watercolor Bleed", false, "needs WebGL2");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "Watercolor Bleed",
  func: watercolorBleed,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Stylized single-field watercolour approximation with eight-neighbour pigment diffusion, luminance-based edge deposition, and paper grain",
  requiresGL: true,
  noWASM: "Iterative neighborhood diffusion is GPU-bound and has no maintained CPU implementation.",
});
