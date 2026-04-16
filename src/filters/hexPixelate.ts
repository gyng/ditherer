import { RANGE, BOOL, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  clamp,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
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

const SQRT3 = Math.sqrt(3);

const roundHex = (qf: number, rf: number): [number, number] => {
  const x = qf;
  const z = rf;
  const y = -x - z;
  let rx = Math.round(x);
  const ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else rz = -rx - ry;

  return [rx, rz];
};

const pixelToHex = (x: number, y: number, size: number): [number, number] => {
  const px = x - size;
  const py = y - size;
  const q = (SQRT3 / 3 * px - py / 3) / size;
  const r = (2 / 3 * py) / size;
  return roundHex(q, r);
};

const hexToCenter = (q: number, r: number, size: number): [number, number] => ([
  size * SQRT3 * (q + r / 2) + size,
  size * 1.5 * r + size
]);

const sameHex = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

export const optionTypes = {
  cellSize: { type: RANGE, range: [4, 64], step: 1, default: 16, desc: "Hex cell diameter in pixels" },
  outline: { type: BOOL, default: false, desc: "Draw 1px seams between neighboring hex cells" },
  outlineColor: { type: COLOR, default: [0, 0, 0], desc: "Outline color when seam drawing is enabled" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  outline: optionTypes.outline.default,
  outlineColor: optionTypes.outlineColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// GLSL version of pixelToHex→roundHex→hexToCenter. Samples the source at
// each hex cell's centre; optional seam overlay compares the neighbouring
// cell IDs to detect edges.
const HEX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_size;
uniform int   u_outline;
uniform vec3  u_outlineColor;

const float SQRT3 = 1.7320508;

vec2 roundHex(float qf, float rf) {
  float x = qf;
  float z = rf;
  float y = -x - z;
  float rx = floor(x + 0.5);
  float ry = floor(y + 0.5);
  float rz = floor(z + 0.5);
  float xDiff = abs(rx - x);
  float yDiff = abs(ry - y);
  float zDiff = abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else rz = -rx - ry;
  return vec2(rx, rz);
}

vec2 pxToHex(float x, float y) {
  float px = x - u_size;
  float py = y - u_size;
  float q = (SQRT3 / 3.0 * px - py / 3.0) / u_size;
  float r = (2.0 / 3.0 * py) / u_size;
  return roundHex(q, r);
}

vec2 hexToCenter(vec2 qr) {
  return vec2(
    u_size * SQRT3 * (qr.x + qr.y * 0.5) + u_size,
    u_size * 1.5 * qr.y + u_size
  );
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec2 cell = pxToHex(x, y);

  if (u_outline == 1) {
    vec2 right = pxToHex(min(u_res.x - 1.0, x + 1.0), y);
    vec2 down = pxToHex(x, min(u_res.y - 1.0, y + 1.0));
    if (right != cell || down != cell) {
      fragColor = vec4(u_outlineColor, 1.0);
      return;
    }
  }

  vec2 c = hexToCenter(cell);
  float sx = clamp(floor(c.x + 0.5), 0.0, u_res.x - 1.0);
  float sy = clamp(floor(c.y + 0.5), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y);
  fragColor = texture(u_source, uv);
}
`;

type Cache = { hex: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    hex: linkProgram(gl, HEX_FS, [
      "u_source", "u_res", "u_size", "u_outline", "u_outlineColor",
    ] as const),
  };
  return _cache;
};

const hexPixelate = (input: any, options = defaults) => {
  const { cellSize, outline, outlineColor, palette } = options;
  const W = input.width, H = input.height;
  const size = Math.max(2, cellSize * 0.5);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "hexPixelate:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.hex, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.hex.uniforms.u_source, 0);
        gl.uniform2f(cache.hex.uniforms.u_res, W, H);
        gl.uniform1f(cache.hex.uniforms.u_size, size);
        gl.uniform1i(cache.hex.uniforms.u_outline, outline ? 1 : 0);
        gl.uniform3f(cache.hex.uniforms.u_outlineColor, outlineColor[0] / 255, outlineColor[1] / 255, outlineColor[2] / 255);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Hex Pixelate", "WebGL2",
            `size=${cellSize}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Hex Pixelate", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = pixelToHex(x, y, size);
      const i = getBufferIndex(x, y, W);

      if (outline) {
        const right = pixelToHex(Math.min(W - 1, x + 1), y, size);
        const down = pixelToHex(x, Math.min(H - 1, y + 1), size);
        if (!sameHex(cell, right) || !sameHex(cell, down)) {
          outBuf[i] = outlineColor[0];
          outBuf[i + 1] = outlineColor[1];
          outBuf[i + 2] = outlineColor[2];
          outBuf[i + 3] = 255;
          continue;
        }
      }

      const [cx, cy] = hexToCenter(cell[0], cell[1], size);
      const sx = clamp(0, W - 1, Math.round(cx));
      const sy = clamp(0, H - 1, Math.round(cy));
      const si = getBufferIndex(sx, sy, W);
      const color = srgbPaletteGetColor(
        palette,
        rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]),
        palette.options
      );

      outBuf[i] = color[0];
      outBuf[i + 1] = color[1];
      outBuf[i + 2] = color[2];
      outBuf[i + 3] = buf[si + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Hex Pixelate",
  func: hexPixelate,
  optionTypes,
  options: defaults,
  defaults
});
