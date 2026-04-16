import { BOOL, PALETTE } from "constants/controlTypes";

import { nearest } from "palettes";
import { defineFilter, type FilterOptionValues } from "filters/types";

import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  quantizeValue,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
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

export const optionTypes = {
  grayscale: { type: BOOL, default: false, desc: "Apply same random value to all channels" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  grayscale: optionTypes.grayscale.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } },
};

type RandomOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
  _webglAcceleration?: boolean;
};

// When the palette is the default identity (levels≥256, no colours), the
// shader does per-channel levels-quantize inline for performance. When the
// user picks a custom palette, the shader only adds noise and the final
// colour snap is handed to `applyPalettePassToCanvas`.
const RANDOM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_levels;
uniform int   u_quantize;    // 1 = apply built-in levels quantize, 0 = noise only
uniform int   u_grayscale;
uniform int   u_linearize;
uniform float u_seed;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float quantize(float v) {
  float L = max(1.0, u_levels);
  return clamp(floor(v * (L - 1.0) + 0.5) / max(L - 1.0, 1e-6), 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);
  vec3 src = u_linearize == 1 ? srgbToLinear(c.rgb) : c.rgb;

  vec3 noisy;
  if (u_grayscale == 1) {
    float intensity = (src.r + src.g + src.b) / 3.0;
    float n = hash(vec2(x, y), u_seed) - 0.5;
    float g = u_quantize == 1 ? quantize(intensity + n) : clamp(intensity + n, 0.0, 1.0);
    noisy = vec3(g);
  } else {
    float nr = hash(vec2(x, y) + vec2(1.0), u_seed) - 0.5;
    float ng = hash(vec2(x, y) + vec2(2.0), u_seed) - 0.5;
    float nb = hash(vec2(x, y) + vec2(3.0), u_seed) - 0.5;
    vec3 withNoise = vec3(src.r + nr, src.g + ng, src.b + nb);
    noisy = u_quantize == 1
      ? vec3(quantize(withNoise.r), quantize(withNoise.g), quantize(withNoise.b))
      : clamp(withNoise, 0.0, 1.0);
  }
  vec3 rgb = u_linearize == 1 ? linearToSrgb(noisy) : noisy;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { rand: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    rand: linkProgram(gl, RANDOM_FS, [
      "u_source", "u_res", "u_levels", "u_quantize", "u_grayscale",
      "u_linearize", "u_seed",
    ] as const),
  };
  return _cache;
};

const random = (
  input: any,
  options: RandomOptions = defaults
) => {
  const linearize = options._linearize === true;
  const palette = options.palette ?? defaults.palette;
  const paletteOpts = (palette as { options?: { levels?: number } }).options;
  const levels = paletteOpts?.levels ?? 2;
  const paletteIdentity = paletteIsIdentity(palette);
  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "random:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.rand, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.rand.uniforms.u_source, 0);
        gl.uniform2f(cache.rand.uniforms.u_res, W, H);
        gl.uniform1f(cache.rand.uniforms.u_levels, Math.max(1, levels));
        gl.uniform1i(cache.rand.uniforms.u_quantize, paletteIdentity ? 1 : 0);
        gl.uniform1i(cache.rand.uniforms.u_grayscale, options.grayscale ? 1 : 0);
        gl.uniform1i(cache.rand.uniforms.u_linearize, linearize ? 1 : 0);
        gl.uniform1f(cache.rand.uniforms.u_seed, (Math.random() * 1000) % 1);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const out = paletteIdentity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Random", "WebGL2",
            paletteIdentity
              ? `levels=${levels}${linearize ? " linearized" : ""}`
              : `noise+palettePass${linearize ? " linearized" : ""}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Random", false, "fallback JS");
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const pickColor = (r: number, g: number, b: number, a: number): [number, number, number, number] => {
    const c = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
    return [c[0], c[1], c[2], c[3] ?? a];
  };

  if (linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);

        if (options.grayscale) {
          const intensity = (floatBuf[i] + floatBuf[i + 1] + floatBuf[i + 2]) / 3;
          const gray255 = quantizeValue(
            intensity * 255 + (Math.random() - 0.5) * 255,
            levels
          );
          const grayF = gray255 / 255;
          fillBufferPixel(floatBuf, i, grayF, grayF, grayF, floatBuf[i + 3]);
        } else {
          const r = floatBuf[i] * 255 + (Math.random() - 0.5) * 255;
          const g = floatBuf[i + 1] * 255 + (Math.random() - 0.5) * 255;
          const b = floatBuf[i + 2] * 255 + (Math.random() - 0.5) * 255;
          const color = pickColor(r, g, b, floatBuf[i + 3] * 255);
          fillBufferPixel(floatBuf, i, color[0] / 255, color[1] / 255, color[2] / 255, floatBuf[i + 3]);
        }
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);

        if (options.grayscale) {
          const intensity = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
          const gray = quantizeValue(
            intensity + (Math.random() - 0.5) * 255,
            levels
          );
          fillBufferPixel(buf, i, gray, gray, gray, buf[i + 3]);
        } else {
          const r = buf[i] + (Math.random() - 0.5) * 255;
          const g = buf[i + 1] + (Math.random() - 0.5) * 255;
          const b = buf[i + 2] + (Math.random() - 0.5) * 255;
          const color = pickColor(r, g, b, buf[i + 3]);
          fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter<RandomOptions>({
  name: "Random",
  func: random,
  options: defaults,
  optionTypes,
  defaults
});
