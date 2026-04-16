import { RANGE, PALETTE, BOOL, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
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

const MODE_AXIAL       = "AXIAL";
const MODE_INDEPENDENT = "INDEPENDENT";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Axial (angle + radial)", value: MODE_AXIAL },
      { name: "Per-channel", value: MODE_INDEPENDENT }
    ],
    default: MODE_AXIAL,
    desc: "Aberration model — axial or manual per-channel offsets"
  },
  strength: { type: RANGE, range: [0, 50], step: 0.5, default: 8, desc: "Overall aberration intensity" },
  angle:    { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Direction of color fringing in degrees" },
  radial:   { type: BOOL, default: true, desc: "Increase fringing toward image edges" },
  rOffsetX: { type: RANGE, range: [-50, 50], step: 0.5, default: -8, desc: "Red channel horizontal offset" },
  rOffsetY: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Red channel vertical offset" },
  gOffsetX: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Green channel horizontal offset" },
  gOffsetY: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Green channel vertical offset" },
  bOffsetX: { type: RANGE, range: [-50, 50], step: 0.5, default: 8, desc: "Blue channel horizontal offset" },
  bOffsetY: { type: RANGE, range: [-50, 50], step: 0.5, default: 0, desc: "Blue channel vertical offset" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  strength: optionTypes.strength.default,
  angle: optionTypes.angle.default,
  radial: optionTypes.radial.default,
  rOffsetX: optionTypes.rOffsetX.default,
  rOffsetY: optionTypes.rOffsetY.default,
  gOffsetX: optionTypes.gOffsetX.default,
  gOffsetY: optionTypes.gOffsetY.default,
  bOffsetX: optionTypes.bOffsetX.default,
  bOffsetY: optionTypes.bOffsetY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;         // 0 AXIAL, 1 INDEPENDENT
uniform float u_strength;
uniform float u_dx;           // cos(angle)
uniform float u_dy;           // sin(angle)
uniform int   u_radial;
uniform vec2  u_rOffset;
uniform vec2  u_gOffset;
uniform vec2  u_bOffset;
uniform float u_levels;

// Nearest-pixel sampler matching the CPU path's Math.round + clamp.
vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float rx, ry, gx, gy, bx, by;
  if (u_mode == 1) {
    rx = x + u_rOffset.x; ry = y + u_rOffset.y;
    gx = x + u_gOffset.x; gy = y + u_gOffset.y;
    bx = x + u_bOffset.x; by = y + u_bOffset.y;
  } else {
    float distFactor = 1.0;
    if (u_radial == 1) {
      float cx = u_res.x * 0.5;
      float cy = u_res.y * 0.5;
      float maxDist = sqrt(cx * cx + cy * cy);
      float ddx = x - cx;
      float ddy = y - cy;
      distFactor = sqrt(ddx * ddx + ddy * ddy) / maxDist;
    }
    float offset = u_strength * distFactor;
    rx = x - u_dx * offset; ry = y - u_dy * offset;
    gx = x;                 gy = y;
    bx = x + u_dx * offset; by = y + u_dy * offset;
  }

  float r = samplePx(rx, ry).r;
  float g = samplePx(gx, gy).g;
  float b = samplePx(bx, by).b;

  vec3 rgb = vec3(r, g, b);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  // Alpha from the centre pixel, matching the CPU reference.
  float a = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).a;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

type Cache = { ca: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ca: linkProgram(gl, CA_FS, [
      "u_source", "u_res", "u_mode", "u_strength", "u_dx", "u_dy",
      "u_radial", "u_rOffset", "u_gOffset", "u_bOffset", "u_levels",
    ] as const),
  };
  return _cache;
};

const clampCoord = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(v)));

const chromaticAberration = (input: any, options = defaults) => {
  const { mode, strength, angle, radial, rOffsetX, rOffsetY, gOffsetX, gOffsetY, bOffsetX, bOffsetY, palette } = options;
  const W = input.width;
  const H = input.height;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "chromaticAberration:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ca, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ca.uniforms.u_source, 0);
        gl.uniform2f(cache.ca.uniforms.u_res, W, H);
        gl.uniform1i(cache.ca.uniforms.u_mode, mode === MODE_INDEPENDENT ? 1 : 0);
        gl.uniform1f(cache.ca.uniforms.u_strength, strength);
        gl.uniform1f(cache.ca.uniforms.u_dx, dx);
        gl.uniform1f(cache.ca.uniforms.u_dy, dy);
        gl.uniform1i(cache.ca.uniforms.u_radial, radial ? 1 : 0);
        gl.uniform2f(cache.ca.uniforms.u_rOffset, rOffsetX, rOffsetY);
        gl.uniform2f(cache.ca.uniforms.u_gOffset, gOffsetX, gOffsetY);
        gl.uniform2f(cache.ca.uniforms.u_bOffset, bOffsetX, bOffsetY);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.ca.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Chromatic aberration", "WebGL2",
            `${mode} strength=${strength}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Chromatic aberration", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);

      let rX: number, rY: number, gX: number, gY: number, bX: number, bY: number;

      if (mode === MODE_INDEPENDENT) {
        rX = clampCoord(x + rOffsetX, W); rY = clampCoord(y + rOffsetY, H);
        gX = clampCoord(x + gOffsetX, W); gY = clampCoord(y + gOffsetY, H);
        bX = clampCoord(x + bOffsetX, W); bY = clampCoord(y + bOffsetY, H);
      } else {
        let distFactor = 1;
        if (radial) {
          const distX = x - cx;
          const distY = y - cy;
          distFactor = Math.sqrt(distX * distX + distY * distY) / maxDist;
        }
        const offset = strength * distFactor;
        rX = clampCoord(x - dx * offset, W); rY = clampCoord(y - dy * offset, H);
        gX = x;                               gY = y;
        bX = clampCoord(x + dx * offset, W); bY = clampCoord(y + dy * offset, H);
      }

      const rI = getBufferIndex(rX, rY, W);
      const gI = getBufferIndex(gX, gY, W);
      const bI = getBufferIndex(bX, bY, W);

      const col = srgbPaletteGetColor(
        palette,
        rgba(buf[rI], buf[gI + 1], buf[bI + 2], buf[i + 3]),
        palette.options
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Chromatic aberration",
  func: chromaticAberration,
  options: defaults,
  optionTypes,
  defaults
});
