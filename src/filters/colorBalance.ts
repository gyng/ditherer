import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
  clamp,
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
  shadowR:    { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Red shift in shadows" },
  shadowG:    { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Green shift in shadows" },
  shadowB:    { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Blue shift in shadows" },
  midtoneR:   { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Red shift in midtones" },
  midtoneG:   { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Green shift in midtones" },
  midtoneB:   { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Blue shift in midtones" },
  highlightR: { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Red shift in highlights" },
  highlightG: { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Green shift in highlights" },
  highlightB: { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Blue shift in highlights" },
  palette:    { type: PALETTE, default: nearest }
};

export const defaults = {
  shadowR: 0, shadowG: 0, shadowB: 0,
  midtoneR: 0, midtoneG: 0, midtoneB: 0,
  highlightR: 0, highlightG: 0, highlightB: 0,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CB_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec3  u_shadow;       // (R, G, B) shift -100..100
uniform vec3  u_midtone;
uniform vec3  u_highlight;
uniform float u_levels;

void main() {
  vec4 c = texture(u_source, v_uv);
  float t = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float sw = max(0.0, 1.0 - t * 4.0);
  float hw = max(0.0, t * 4.0 - 3.0);
  float mw = 1.0 - sw - hw;

  vec3 d = sw * u_shadow + mw * u_midtone + hw * u_highlight;
  vec3 rgb = clamp(c.rgb + d * (2.55 / 255.0), 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { cb: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cb: linkProgram(gl, CB_FS, [
      "u_source", "u_shadow", "u_midtone", "u_highlight", "u_levels",
    ] as const),
  };
  return _cache;
};

const shadowMask    = (t: number) => Math.max(0, 1 - t * 4);
const highlightMask = (t: number) => Math.max(0, t * 4 - 3);
const midtoneMask   = (t: number) => 1 - shadowMask(t) - highlightMask(t);

const colorBalance = (input: any, options = defaults) => {
  const {
    shadowR, shadowG, shadowB,
    midtoneR, midtoneG, midtoneB,
    highlightR, highlightG, highlightB,
    palette
  } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "colorBalance:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.cb, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.cb.uniforms.u_source, 0);
        gl.uniform3f(cache.cb.uniforms.u_shadow, shadowR, shadowG, shadowB);
        gl.uniform3f(cache.cb.uniforms.u_midtone, midtoneR, midtoneG, midtoneB);
        gl.uniform3f(cache.cb.uniforms.u_highlight, highlightR, highlightG, highlightB);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.cb.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Color balance", "WebGL2", identity ? "direct" : "direct+palettePass");
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Color balance", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const t = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      const sw = shadowMask(t);
      const mw = midtoneMask(t);
      const hw = highlightMask(t);

      const dr = sw * shadowR + mw * midtoneR + hw * highlightR;
      const dg = sw * shadowG + mw * midtoneG + hw * highlightG;
      const db = sw * shadowB + mw * midtoneB + hw * highlightB;

      const r = clamp(0, 255, Math.round(buf[i]     + dr * 2.55));
      const g = clamp(0, 255, Math.round(buf[i + 1] + dg * 2.55));
      const b = clamp(0, 255, Math.round(buf[i + 2] + db * 2.55));

      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Color balance",
  func: colorBalance,
  options: defaults,
  optionTypes,
  defaults
});
