import { RANGE, PALETTE } from "constants/controlTypes";
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
  type TexEntry,
} from "gl";

// Proper wet-on-wet watercolor: iterative pigment diffusion where darker
// pigment pools into wet basins and bright edges develop "bloom" ridges
// where pigment is pushed outward. Each iteration does a two-tap colour
// diffusion toward the spatial neighbourhood, modulated by pigment
// "wetness" (inverse luminance), plus edge darkening to simulate the
// characteristic watercolour edge-bleed ring. Finished with a paper
// texture.

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
  // Wetness = inverse luminance: dark pigment carries more water.
  float cL = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float wet = mix(1.0, 1.0 - cL, u_wetness);

  // Weighted average to neighbours — this is the pigment migration.
  vec4 avg = (l + r + d + t) * 0.25;
  vec4 diff = avg - c;
  vec4 migrated = c + diff * u_flow * wet;

  // Edge-bloom: detect where pigment has piled up vs. neighbours, darken
  // slightly there to simulate the classic watercolour edge ring.
  float lapL = (l.r + r.r + d.r + t.r) * 0.25 - c.r;
  float edge = clamp(-lapL * 4.0, 0.0, 1.0);
  migrated.rgb *= 1.0 - edge * u_edgeBloom * 0.4;
  fragColor = vec4(clamp(migrated.rgb, 0.0, 1.0), 1.0);
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

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec4 pig = texelFetch(u_pigment, ivec2(x, floor(px.y)), 0);
  vec3 rgb = pig.rgb;
  if (u_paper > 0.0) {
    float n1 = hash(vec2(x, y));
    float n2 = hash(vec2(x * 0.3, y * 0.3));
    float grain = (n1 - 0.5) * 0.12 + (n2 - 0.5) * 0.2;
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
  fragColor = vec4(rgb, 1.0);
}
`;

export const optionTypes = {
  iterations: { type: RANGE, range: [1, 32], step: 1, default: 14, desc: "Pigment-diffusion iterations — more = softer bleed" },
  flow: { type: RANGE, range: [0, 0.6], step: 0.02, default: 0.25, desc: "Per-step diffusion amount — higher = more watery" },
  wetness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "How much dark pigment migrates faster (wet-into-wet)" },
  edgeBloom: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Edge ring darkening — the signature watercolor halo" },
  paperTexture: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Visible paper grain" },
  palette: { type: PALETTE, default: nearest },
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
      "u_prev", "u_source", "u_res", "u_flow", "u_edgeBloom", "u_wetness",
    ] as const),
    paper: linkProgram(gl, PAPER_FS, ["u_pigment", "u_res", "u_paper", "u_levels"] as const),
  };
  return _cache;
};

const watercolorBleed = (input: any, options = defaults) => {
  const { iterations, flow, wetness, edgeBloom, paperTexture, palette } = options;
  const W = input.width, H = input.height;

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
      let src = sourceTex, dst = bufA;
      const iters = Math.max(1, Math.min(32, Math.round(iterations)));
      for (let i = 0; i < iters; i++) {
        drawPass(gl, dst, W, H, cache.diffuse, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform1i(cache.diffuse.uniforms.u_prev, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.diffuse.uniforms.u_source, 1);
          gl.uniform2f(cache.diffuse.uniforms.u_res, W, H);
          gl.uniform1f(cache.diffuse.uniforms.u_flow, flow);
          gl.uniform1f(cache.diffuse.uniforms.u_edgeBloom, edgeBloom);
          gl.uniform1f(cache.diffuse.uniforms.u_wetness, wetness);
        }, vao);
        // After first pass, ping-pong between A and B.
        if (i === 0) { src = bufA; dst = bufB; }
        else { [src, dst] = [dst, src]; }
      }

      drawPass(gl, null, W, H, cache.paper, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(cache.paper.uniforms.u_pigment, 0);
        gl.uniform2f(cache.paper.uniforms.u_res, W, H);
        gl.uniform1f(cache.paper.uniforms.u_paper, paperTexture);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.paper.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Watercolor Bleed", "WebGL2",
            `iters=${iters} flow=${flow}${identity ? "" : "+palettePass"}`);
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
  description: "Wet-on-wet watercolour: iterative pigment diffusion with wetness-weighted flow and edge blooms — dark colours migrate faster, edges develop the signature halo ring",
  noWASM: "Iterative diffusion at 1280×720 is 4-8× slower on CPU than a single GL pass.",
});
