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
  rOffsetX: { type: RANGE, range: [0, 100], default: 10, desc: "Red channel horizontal offset" },
  rOffsetY: { type: RANGE, range: [0, 100], default: 0, desc: "Red channel vertical offset" },
  rOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Red channel opacity" },
  gOffsetX: { type: RANGE, range: [0, 100], default: 0, desc: "Green channel horizontal offset" },
  gOffsetY: { type: RANGE, range: [0, 100], default: 5, desc: "Green channel vertical offset" },
  gOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Green channel opacity" },
  bOffsetX: { type: RANGE, range: [0, 100], default: 8, desc: "Blue channel horizontal offset" },
  bOffsetY: { type: RANGE, range: [0, 100], default: 4, desc: "Blue channel vertical offset" },
  bOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Blue channel opacity" },
  aOffsetX: { type: RANGE, range: [0, 100], default: 0, desc: "Alpha channel horizontal offset" },
  aOffsetY: { type: RANGE, range: [0, 100], default: 0, desc: "Alpha channel vertical offset" },
  aOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Alpha channel opacity" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  rOffsetX: optionTypes.rOffsetX.default,
  rOffsetY: optionTypes.rOffsetY.default,
  rOpacity: optionTypes.rOpacity.default,
  gOffsetX: optionTypes.gOffsetX.default,
  gOffsetY: optionTypes.gOffsetY.default,
  gOpacity: optionTypes.gOpacity.default,
  bOffsetX: optionTypes.bOffsetX.default,
  bOffsetY: optionTypes.bOffsetY.default,
  bOpacity: optionTypes.bOpacity.default,
  aOffsetX: optionTypes.aOffsetX.default,
  aOffsetY: optionTypes.aOffsetY.default,
  aOpacity: optionTypes.aOpacity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_rOff;
uniform vec2  u_gOff;
uniform vec2  u_bOff;
uniform vec2  u_aOff;
uniform vec4  u_opacity;  // (rOp, gOp, bOp, aOp)

// CPU reads past-end indices for offsets past-edge — effectively sampling
// out-of-bounds returns 0. Matches that with a transparent-black sample.
vec4 samplePx(float sx, float sy) {
  if (sx < 0.0 || sx >= u_res.x || sy < 0.0 || sy >= u_res.y) return vec4(0.0);
  float cx = floor(sx);
  float cy = floor(sy);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float r = samplePx(x + u_rOff.x, y + u_rOff.y).r;
  float g = samplePx(x + u_gOff.x, y + u_gOff.y).g;
  float b = samplePx(x + u_bOff.x, y + u_bOff.y).b;
  float a = samplePx(x + u_aOff.x, y + u_aOff.y).a;

  vec4 rgba4 = vec4(r, g, b, a) * u_opacity;
  fragColor = clamp(rgba4, 0.0, 1.0);
}
`;

type Cache = { cs: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cs: linkProgram(gl, CS_FS, [
      "u_source", "u_res", "u_rOff", "u_gOff", "u_bOff", "u_aOff", "u_opacity",
    ] as const),
  };
  return _cache;
};

const channelSeparation = (
  input: any,
  options = defaults
) => {
  const {
    rOffsetX,
    rOffsetY,
    rOpacity,
    gOffsetX,
    gOffsetY,
    gOpacity,
    bOffsetX,
    bOffsetY,
    bOpacity,
    aOffsetX,
    aOffsetY,
    aOpacity,
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
      const sourceTex = ensureTexture(gl, "channelSeparation:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.cs, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.cs.uniforms.u_source, 0);
        gl.uniform2f(cache.cs.uniforms.u_res, W, H);
        gl.uniform2f(cache.cs.uniforms.u_rOff, rOffsetX, rOffsetY);
        gl.uniform2f(cache.cs.uniforms.u_gOff, gOffsetX, gOffsetY);
        gl.uniform2f(cache.cs.uniforms.u_bOff, bOffsetX, bOffsetY);
        gl.uniform2f(cache.cs.uniforms.u_aOff, aOffsetX, aOffsetY);
        gl.uniform4f(cache.cs.uniforms.u_opacity, rOpacity, gOpacity, bOpacity, aOpacity);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Channel separation", "WebGL2", identity ? "direct" : "direct+palettePass");
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Channel separation", false, "fallback JS");
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);

      const rX = rOffsetX + x;
      const rY = rOffsetY + y;
      const rI = getBufferIndex(rX, rY, input.width);

      const gX = gOffsetX + x;
      const gY = gOffsetY + y;
      const gI = getBufferIndex(gX, gY, input.width);

      const bX = bOffsetX + x;
      const bY = bOffsetY + y;
      const bI = getBufferIndex(bX, bY, input.width);

      const aX = aOffsetX + x;
      const aY = aOffsetY + y;
      const aI = getBufferIndex(aX, aY, input.width);

      const pixel = rgba(buf[rI], buf[gI + 1], buf[bI + 2], buf[aI + 3]);
      const color = paletteGetColor(palette, pixel, palette.options, false);
      fillBufferPixel(
        buf,
        i,
        color[0] * rOpacity,
        color[1] * gOpacity,
        color[2] * bOpacity,
        color[3] * aOpacity
      );
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Channel separation",
  func: channelSeparation,
  options: defaults,
  optionTypes,
  defaults
});
