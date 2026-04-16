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
  hueCenter: { type: RANGE, range: [0, 360], step: 5, default: 0, desc: "Target hue to isolate in degrees" },
  hueRange: { type: RANGE, range: [5, 180], step: 5, default: 30, desc: "Width of hue band around center" },
  saturationMin: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Minimum saturation to keep as color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  hueCenter: optionTypes.hueCenter.default,
  hueRange: optionTypes.hueRange.default,
  saturationMin: optionTypes.saturationMin.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// HSL to match the CPU path's math exactly.
const CT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_hueCenter;
uniform float u_hueRange;
uniform float u_saturationMin;
uniform float u_levels;

void main() {
  vec4 c = texture(u_source, v_uv);
  float r = c.r, g = c.g, b = c.b;
  float mx = max(max(r, g), b);
  float mn = min(min(r, g), b);
  float l = (mx + mn) * 0.5;
  float h = 0.0;
  float s = 0.0;
  if (mx != mn) {
    float d = mx - mn;
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == r) h = ((g - b) / d + (g < b ? 6.0 : 0.0)) / 6.0;
    else if (mx == g) h = ((b - r) / d + 2.0) / 6.0;
    else h = ((r - g) / d + 4.0) / 6.0;
  }
  float hueDeg = h * 360.0;

  float hueDist = abs(hueDeg - u_hueCenter);
  if (hueDist > 180.0) hueDist = 360.0 - hueDist;
  bool inRange = hueDist <= u_hueRange && s >= u_saturationMin;

  vec3 rgb;
  if (inRange) {
    rgb = c.rgb;
  } else {
    float gray = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    rgb = vec3(gray);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { ct: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ct: linkProgram(gl, CT_FS, [
      "u_source", "u_hueCenter", "u_hueRange", "u_saturationMin", "u_levels",
    ] as const),
  };
  return _cache;
};

const colorThreshold = (input: any, options = defaults) => {
  const { hueCenter, hueRange, saturationMin, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "colorThreshold:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ct, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ct.uniforms.u_source, 0);
        gl.uniform1f(cache.ct.uniforms.u_hueCenter, hueCenter);
        gl.uniform1f(cache.ct.uniforms.u_hueRange, hueRange);
        gl.uniform1f(cache.ct.uniforms.u_saturationMin, saturationMin);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.ct.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Color Threshold", "WebGL2",
            `center=${hueCenter} range=${hueRange}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Color Threshold", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = buf[i] / 255, g = buf[i + 1] / 255, b = buf[i + 2] / 255;

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0, s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      const hueDeg = h * 360;

      let hueDist = Math.abs(hueDeg - hueCenter);
      if (hueDist > 180) hueDist = 360 - hueDist;
      const inRange = hueDist <= hueRange && s >= saturationMin;

      let or: number, og: number, ob: number;
      if (inRange) {
        or = buf[i]; og = buf[i + 1]; ob = buf[i + 2];
      } else {
        const gray = Math.round(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]);
        or = gray; og = gray; ob = gray;
      }

      const color = paletteGetColor(palette, rgba(or, og, ob, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Color Threshold", func: colorThreshold, optionTypes, options: defaults, defaults });
