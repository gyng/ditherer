import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
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

const MODE = {
  MULTIPLY: "MULTIPLY",
  SCREEN: "SCREEN",
  OVERLAY: "OVERLAY",
  SOFT_LIGHT: "SOFT_LIGHT",
  HARD_LIGHT: "HARD_LIGHT",
  DIFFERENCE: "DIFFERENCE",
  EXCLUSION: "EXCLUSION"
};
const MODE_ID: Record<string, number> = {
  MULTIPLY: 0, SCREEN: 1, OVERLAY: 2, SOFT_LIGHT: 3,
  HARD_LIGHT: 4, DIFFERENCE: 5, EXCLUSION: 6,
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Multiply", value: MODE.MULTIPLY },
      { name: "Screen", value: MODE.SCREEN },
      { name: "Overlay", value: MODE.OVERLAY },
      { name: "Soft Light", value: MODE.SOFT_LIGHT },
      { name: "Hard Light", value: MODE.HARD_LIGHT },
      { name: "Difference", value: MODE.DIFFERENCE },
      { name: "Exclusion", value: MODE.EXCLUSION }
    ],
    default: MODE.MULTIPLY,
    desc: "Blend mode used to combine the color with the image"
  },
  color: { type: COLOR, default: [200, 150, 100], desc: "Solid color to blend with the image" },
  opacity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Mix amount between original (0) and blended result (1)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  color: optionTypes.color.default,
  opacity: optionTypes.opacity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec3  u_color;      // 0..1
uniform int   u_mode;       // 0 MUL..6 EXCL
uniform float u_opacity;
uniform float u_levels;

vec3 blendAll(vec3 a, vec3 b, int mode) {
  if (mode == 0) return a * b;                          // MULTIPLY
  if (mode == 1) return vec3(1.0) - (vec3(1.0) - a) * (vec3(1.0) - b); // SCREEN
  if (mode == 2) return mix(                            // OVERLAY
    2.0 * a * b,
    vec3(1.0) - 2.0 * (vec3(1.0) - a) * (vec3(1.0) - b),
    step(vec3(0.5), a));
  if (mode == 3) {                                      // SOFT_LIGHT
    vec3 lo = a - (vec3(1.0) - 2.0 * b) * a * (vec3(1.0) - a);
    vec3 hi = a + (2.0 * b - vec3(1.0)) * (sqrt(a) - a);
    return mix(lo, hi, step(vec3(0.5), b));
  }
  if (mode == 4) return mix(                            // HARD_LIGHT
    2.0 * a * b,
    vec3(1.0) - 2.0 * (vec3(1.0) - a) * (vec3(1.0) - b),
    step(vec3(0.5), b));
  if (mode == 5) return abs(a - b);                     // DIFFERENCE
  return a + b - 2.0 * a * b;                           // EXCLUSION
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 blended = clamp(blendAll(c.rgb, u_color, u_mode), 0.0, 1.0);
  vec3 rgb = mix(c.rgb, blended, u_opacity);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { blend: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blend: linkProgram(gl, BLEND_FS, [
      "u_source", "u_color", "u_mode", "u_opacity", "u_levels",
    ] as const),
  };
  return _cache;
};

const blendChannel = (a: number, b: number, mode: string): number => {
  const an = a / 255;
  const bn = b / 255;
  let result: number;

  switch (mode) {
    case MODE.MULTIPLY:
      result = an * bn;
      break;
    case MODE.SCREEN:
      result = 1 - (1 - an) * (1 - bn);
      break;
    case MODE.OVERLAY:
      result = an < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn);
      break;
    case MODE.SOFT_LIGHT:
      result = bn < 0.5
        ? an - (1 - 2 * bn) * an * (1 - an)
        : an + (2 * bn - 1) * (Math.sqrt(an) - an);
      break;
    case MODE.HARD_LIGHT:
      result = bn < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn);
      break;
    case MODE.DIFFERENCE:
      result = Math.abs(an - bn);
      break;
    case MODE.EXCLUSION:
      result = an + bn - 2 * an * bn;
      break;
    default:
      result = an;
  }

  return Math.round(Math.max(0, Math.min(1, result)) * 255);
};

const blendFilter = (input: any, options = defaults) => {
  const { mode, color, opacity, palette } = options;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "blend:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.blend, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.blend.uniforms.u_source, 0);
        gl.uniform3f(cache.blend.uniforms.u_color, color[0] / 255, color[1] / 255, color[2] / 255);
        gl.uniform1i(cache.blend.uniforms.u_mode, MODE_ID[mode] ?? 0);
        gl.uniform1f(cache.blend.uniforms.u_opacity, opacity);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.blend.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Blend", "WebGL2",
            `${mode}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Blend", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      const br = blendChannel(buf[i], color[0], mode);
      const bg = blendChannel(buf[i + 1], color[1], mode);
      const bb = blendChannel(buf[i + 2], color[2], mode);

      const r = Math.round(buf[i] + (br - buf[i]) * opacity);
      const g = Math.round(buf[i + 1] + (bg - buf[i + 1]) * opacity);
      const b = Math.round(buf[i + 2] + (bb - buf[i + 2]) * opacity);

      const c = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, c[0], c[1], c[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Blend",
  func: blendFilter,
  optionTypes,
  options: defaults,
  defaults
});
