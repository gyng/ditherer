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
  rr: { type: RANGE, range: [-1, 2], step: 0.05, default: 1, desc: "Red contribution to output red" },
  rg: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Green contribution to output red" },
  rb: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Blue contribution to output red" },
  gr: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Red contribution to output green" },
  gg: { type: RANGE, range: [-1, 2], step: 0.05, default: 1, desc: "Green contribution to output green" },
  gb: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Blue contribution to output green" },
  br: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Red contribution to output blue" },
  bg: { type: RANGE, range: [-1, 2], step: 0.05, default: 0, desc: "Green contribution to output blue" },
  bb: { type: RANGE, range: [-1, 2], step: 0.05, default: 1, desc: "Blue contribution to output blue" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  rr: 1, rg: 0, rb: 0,
  gr: 0, gg: 1, gb: 0,
  br: 0, bg: 0, bb: 1,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform mat3 u_matrix;
uniform float u_levels;
void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb = clamp(u_matrix * c.rgb, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { cm: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { cm: linkProgram(gl, CM_FS, ["u_source", "u_matrix", "u_levels"] as const) };
  return _cache;
};

const channelMixer = (input: any, options = defaults) => {
  const { rr, rg, rb, gr, gg, gb, br, bg, bb, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "channelMixer:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      // GLSL mat3 column-major: col0=(rr,gr,br), col1=(rg,gg,bg), col2=(rb,gb,bb).
      const matrix = new Float32Array([rr, gr, br, rg, gg, bg, rb, gb, bb]);

      drawPass(gl, null, W, H, cache.cm, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.cm.uniforms.u_source, 0);
        gl.uniformMatrix3fv(cache.cm.uniforms.u_matrix, false, matrix);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.cm.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Channel Mixer", "WebGL2", identity ? "mat3" : "mat3+palettePass");
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Channel Mixer", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const sr = buf[i], sg = buf[i + 1], sb = buf[i + 2];

      const r = Math.max(0, Math.min(255, Math.round(sr * rr + sg * rg + sb * rb)));
      const g = Math.max(0, Math.min(255, Math.round(sr * gr + sg * gg + sb * gb)));
      const b = Math.max(0, Math.min(255, Math.round(sr * br + sg * bg + sb * bb)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Channel Mixer", func: channelMixer, optionTypes, options: defaults, defaults });
