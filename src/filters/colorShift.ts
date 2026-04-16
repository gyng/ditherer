import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  rgba2hsva,
  srgbPaletteGetColor,
  wasmHsvShiftBuffer,
  wasmIsLoaded,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity as paletteIsIdentityShared } from "palettes/backend";
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

// h: 0-360, s/v/a: 0-1 → r/g/b/a: 0-255
const hsva2rgba = ([h, s, v, a]: readonly number[]) => {
  if (s === 0) {
    const c = Math.round(v * 255);
    return [c, c, c, Math.round(a * 255)];
  }
  const hh = (((h % 360) + 360) % 360) / 60;
  const sector = Math.floor(hh);
  const f = hh - sector;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r, g, b;
  switch (sector) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255)];
};

export const optionTypes = {
  hue: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Hue rotation in degrees" },
  saturation: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Saturation adjustment" },
  value: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Brightness/value adjustment" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  hue: optionTypes.hue.default,
  saturation: optionTypes.saturation.default,
  value: optionTypes.value.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_hue;          // degrees
uniform float u_saturation;   // -1..1 additive
uniform float u_value;        // -1..1 additive
uniform float u_levels;

// RGB (0..1) → HSV (h in degrees, s/v in 0..1) matching utils.rgba2hsva.
vec3 rgb2hsv(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-5) {
    if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else                h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  float s = mx > 1e-5 ? d / mx : 0.0;
  return vec3(h, s, mx);
}

// HSV → RGB matching the JS hsva2rgba sector switch.
vec3 hsv2rgb(float h, float s, float v) {
  if (s == 0.0) return vec3(v);
  float hh = mod(mod(h, 360.0) + 360.0, 360.0) / 60.0;
  float sector = floor(hh);
  float f = hh - sector;
  float p = v * (1.0 - s);
  float q = v * (1.0 - s * f);
  float t = v * (1.0 - s * (1.0 - f));
  if (sector < 1.0) return vec3(v, t, p);
  if (sector < 2.0) return vec3(q, v, p);
  if (sector < 3.0) return vec3(p, v, t);
  if (sector < 4.0) return vec3(p, q, v);
  if (sector < 5.0) return vec3(t, p, v);
  return vec3(v, p, q);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);
  float h = hsv.x + u_hue;
  float s = clamp(hsv.y + u_saturation, 0.0, 1.0);
  float v = clamp(hsv.z + u_value, 0.0, 1.0);
  vec3 rgb = hsv2rgb(h, s, v);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { cs: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cs: linkProgram(gl, CS_FS, [
      "u_source", "u_hue", "u_saturation", "u_value", "u_levels",
    ] as const),
  };
  return _cache;
};

const colorShift = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { hue, saturation, value, palette } = options;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "colorShift:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.cs, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.cs.uniforms.u_source, 0);
        gl.uniform1f(cache.cs.uniforms.u_hue, hue);
        gl.uniform1f(cache.cs.uniforms.u_saturation, saturation);
        gl.uniform1f(cache.cs.uniforms.u_value, value);
        const identity = paletteIsIdentityShared(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.cs.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentityShared(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Color shift", "WebGL2",
            `hsv${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmHsvShiftBuffer(buf, buf, hue, saturation, value);
    if (!paletteIsIdentity) {
      for (let i = 0; i < buf.length; i += 4) {
        const col = srgbPaletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options);
        fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
      }
    }
    logFilterWasmStatus("Color shift", true, paletteIsIdentity ? "hsv" : "hsv+palettePass");
    outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
    return output;
  }

  logFilterWasmStatus("Color shift", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");
  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const [h, s, v, a] = rgba2hsva(rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]));
      const shifted = hsva2rgba([
        h + hue,
        Math.max(0, Math.min(1, s + saturation)),
        Math.max(0, Math.min(1, v + value)),
        a
      ]);
      const col = srgbPaletteGetColor(palette, shifted, palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Color shift",
  func: colorShift,
  options: defaults,
  optionTypes,
  defaults
});
