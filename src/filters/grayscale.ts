import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { defineFilter, type FilterOptionValues } from "filters/types";
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

export const optionTypes = {};

export const defaults = {};

type GrayscaleOptions = FilterOptionValues & {
  _linearize?: boolean;
  _webglAcceleration?: boolean;
};

const GRAY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int u_linearize;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec4 c = texture(u_source, v_uv);
  float g;
  if (u_linearize == 1) {
    vec3 lin = srgbToLinear(c.rgb);
    float y = 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
    vec3 back = linearToSrgb(vec3(y));
    fragColor = vec4(back, c.a);
  } else {
    g = (c.r + c.g + c.b) / 3.0;
    fragColor = vec4(g, g, g, c.a);
  }
}
`;

type Cache = { gray: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { gray: linkProgram(gl, GRAY_FS, ["u_source", "u_linearize"] as const) };
  return _cache;
};

const grayscale = (input: any, options: GrayscaleOptions = {}) => {
  const linearize = options._linearize === true;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "grayscale:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.gray, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.gray.uniforms.u_source, 0);
        gl.uniform1i(cache.gray.uniforms.u_linearize, linearize ? 1 : 0);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        logFilterBackend("Grayscale", "WebGL2", linearize ? "linearized" : "direct");
        return rendered;
      }
    }
  }

  logFilterWasmStatus("Grayscale", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const grey = 0.2126 * floatBuf[i] + 0.7152 * floatBuf[i + 1] + 0.0722 * floatBuf[i + 2];
        fillBufferPixel(floatBuf, i, grey, grey, grey, floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const grey = Math.round((buf[i] + buf[i + 1] + buf[i + 2]) / 3);
        fillBufferPixel(buf, i, grey, grey, grey, buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter<GrayscaleOptions>({
  name: "Grayscale",
  func: grayscale,
  options: defaults,
  optionTypes,
  defaults
});
