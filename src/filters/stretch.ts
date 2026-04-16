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
  scaleX: { type: RANGE, range: [0.1, 4], step: 0.05, default: 1.5, desc: "Horizontal scale factor" },
  scaleY: { type: RANGE, range: [0.1, 4], step: 0.05, default: 1, desc: "Vertical scale factor" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of scaling" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of scaling" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scaleX: optionTypes.scaleX.default,
  scaleY: optionTypes.scaleY.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const STRETCH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_center;
uniform vec2  u_invScale;   // (1/scaleX, 1/scaleY)
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec2 src = u_center + (vec2(x, y) - u_center) * u_invScale;
  if (src.x < 0.0 || src.x >= u_res.x || src.y < 0.0 || src.y >= u_res.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // texture() uses the sampler's filter setting; the shared pool is
  // NEAREST by default, so matching the JS bilinear sample requires
  // linear filtering set before the draw.
  vec2 uv = vec2((src.x + 0.5) / u_res.x, 1.0 - (src.y + 0.5) / u_res.y);
  vec4 c = texture(u_source, uv);
  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { stretch: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    stretch: linkProgram(gl, STRETCH_FS, [
      "u_source", "u_res", "u_center", "u_invScale", "u_levels",
    ] as const),
  };
  return _cache;
};

const stretchFilter = (input: any, options = defaults) => {
  const { scaleX, scaleY, centerX, centerY, palette } = options;
  const W = input.width, H = input.height;
  const cx = W * centerX, cy = H * centerY;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "stretch:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      drawPass(gl, null, W, H, cache.stretch, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.stretch.uniforms.u_source, 0);
        gl.uniform2f(cache.stretch.uniforms.u_res, W, H);
        gl.uniform2f(cache.stretch.uniforms.u_center, cx, cy);
        gl.uniform2f(cache.stretch.uniforms.u_invScale, 1 / scaleX, 1 / scaleY);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.stretch.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Stretch", "WebGL2",
            `sx=${scaleX} sy=${scaleY}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Stretch", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = cx + (x - cx) / scaleX;
      const sy = cy + (y - cy) / scaleY;

      const di = getBufferIndex(x, y, W);
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) {
        fillBufferPixel(outBuf, di, 0, 0, 0, 255);
        continue;
      }

      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Stretch", func: stretchFilter, optionTypes, options: defaults, defaults });
