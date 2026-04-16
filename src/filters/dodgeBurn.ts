import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor,
  logFilterBackend, logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const MODE = { DODGE: "DODGE", BURN: "BURN", BOTH: "BOTH" };
const MODE_ID: Record<string, number> = { DODGE: 0, BURN: 1, BOTH: 2 };

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Dodge (lighten shadows)", value: MODE.DODGE },
    { name: "Burn (darken highlights)", value: MODE.BURN },
    { name: "Both", value: MODE.BOTH }
  ], default: MODE.BOTH, desc: "Lighten shadows, darken highlights, or both" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Effect intensity" },
  range: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance range affected by dodge/burn" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  strength: optionTypes.strength.default,
  range: optionTypes.range.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const DB_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform int   u_mode;       // 0 DODGE, 1 BURN, 2 BOTH
uniform float u_strength;
uniform float u_range;      // 0..255 mapped to 0..1
uniform float u_levels;
void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb = c.rgb;
  float lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  float rangeN = u_range / 255.0;

  if ((u_mode == 0 || u_mode == 2) && lum < rangeN && rangeN > 0.0) {
    float factor = 1.0 + u_strength * (1.0 - lum / rangeN);
    rgb = min(vec3(1.0), rgb * factor);
  }
  if ((u_mode == 1 || u_mode == 2) && lum > rangeN && rangeN < 1.0) {
    float factor = 1.0 - u_strength * ((lum - rangeN) / (1.0 - rangeN));
    rgb = max(vec3(0.0), rgb * factor);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { db: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { db: linkProgram(gl, DB_FS, ["u_source", "u_mode", "u_strength", "u_range", "u_levels"] as const) };
  return _cache;
};

const dodgeBurn = (input: any, options = defaults) => {
  const { mode, strength, range: lumRange, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "dodgeBurn:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.db, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.db.uniforms.u_source, 0);
        gl.uniform1i(cache.db.uniforms.u_mode, MODE_ID[mode] ?? 2);
        gl.uniform1f(cache.db.uniforms.u_strength, strength);
        gl.uniform1f(cache.db.uniforms.u_range, lumRange);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.db.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Dodge / Burn", "WebGL2", `${mode}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Dodge / Burn", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Dodge: lighten pixels below range
      if ((mode === MODE.DODGE || mode === MODE.BOTH) && lum < lumRange && lumRange > 0) {
        const factor = 1 + strength * (1 - lum / lumRange);
        r = Math.min(255, Math.round(r * factor));
        g = Math.min(255, Math.round(g * factor));
        b = Math.min(255, Math.round(b * factor));
      }

      // Burn: darken pixels above range
      if ((mode === MODE.BURN || mode === MODE.BOTH) && lum > lumRange && lumRange < 255) {
        const factor = 1 - strength * ((lum - lumRange) / (255 - lumRange));
        r = Math.max(0, Math.round(r * factor));
        g = Math.max(0, Math.round(g * factor));
        b = Math.max(0, Math.round(b * factor));
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Dodge / Burn", func: dodgeBurn, optionTypes, options: defaults, defaults });
