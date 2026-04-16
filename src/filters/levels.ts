import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  linearPaletteGetColor,
  wasmApplyChannelLut,
  wasmIsLoaded,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
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

export const optionTypes = {
  blackPoint: { type: RANGE, range: [0, 255], step: 1, default: 0, desc: "Input shadow clipping point" },
  whitePoint: { type: RANGE, range: [0, 255], step: 1, default: 255, desc: "Input highlight clipping point" },
  gamma: { type: RANGE, range: [0.1, 3], step: 0.05, default: 1, desc: "Midtone gamma curve (>1 brightens, <1 darkens)" },
  outputBlack: { type: RANGE, range: [0, 255], step: 1, default: 0, desc: "Minimum output value (lifts shadows)" },
  outputWhite: { type: RANGE, range: [0, 255], step: 1, default: 255, desc: "Maximum output value (clamps highlights)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  blackPoint: optionTypes.blackPoint.default,
  whitePoint: optionTypes.whitePoint.default,
  gamma: optionTypes.gamma.default,
  outputBlack: optionTypes.outputBlack.default,
  outputWhite: optionTypes.outputWhite.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type LevelsOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
  _webglAcceleration?: boolean;
};

const LEVELS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_inBlack;   // normalised [0,1]
uniform float u_inWhite;
uniform float u_outBlack;
uniform float u_outWhite;
uniform float u_invGamma;
uniform int   u_linearize; // 1 = apply sRGB→linear→remap→linear→sRGB
uniform float u_levels;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 applyLevels(vec3 c) {
  vec3 t = clamp((c - u_inBlack) / max(1e-6, u_inWhite - u_inBlack), 0.0, 1.0);
  t = pow(t, vec3(u_invGamma));
  return clamp(u_outBlack + t * (u_outWhite - u_outBlack), 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec3 c = texture(u_source, suv).rgb;

  vec3 rgb;
  if (u_linearize == 1) {
    vec3 lin = srgbToLinear(c);
    vec3 remapped = applyLevels(lin);
    rgb = linearToSrgb(remapped);
  } else {
    rgb = applyLevels(c);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type GLCache = { levels: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    levels: linkProgram(gl, LEVELS_FS, [
      "u_source", "u_res", "u_inBlack", "u_inWhite", "u_outBlack",
      "u_outWhite", "u_invGamma", "u_linearize", "u_levels",
    ] as const),
  };
  return _glCache;
};

const levelsFilter = (input: any, options: LevelsOptions = defaults) => {
  const { blackPoint, whitePoint, gamma, outputBlack, outputWhite, palette } = options;
  const linearize = options._linearize === true;

  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initGLCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "levels:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.levels, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.levels.uniforms.u_source, 0);
        gl.uniform2f(cache.levels.uniforms.u_res, W, H);
        gl.uniform1f(cache.levels.uniforms.u_inBlack, blackPoint / 255);
        gl.uniform1f(cache.levels.uniforms.u_inWhite, whitePoint / 255);
        gl.uniform1f(cache.levels.uniforms.u_outBlack, outputBlack / 255);
        gl.uniform1f(cache.levels.uniforms.u_outWhite, outputWhite / 255);
        gl.uniform1f(cache.levels.uniforms.u_invGamma, 1 / Math.max(1e-4, gamma));
        gl.uniform1i(cache.levels.uniforms.u_linearize, linearize ? 1 : 0);
        const identity = paletteIsIdentityShared(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.levels.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentityShared(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Levels", "WebGL2",
            `${linearize ? "linearized" : "direct"}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const inputRange = Math.max(1, whitePoint - blackPoint);
  const outputRange = outputWhite - outputBlack;

  if (options._linearize) {
    const inBlack = blackPoint / 255;
    const inWhite = whitePoint / 255;
    const outBlack = outputBlack / 255;
    const outWhite = outputWhite / 255;
    const linearBuf = srgbBufToLinearFloat(buf);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = getBufferIndex(x, y, W);
        for (let c = 0; c < 3; c++) {
          let normalized = (linearBuf[i + c] - inBlack) / Math.max(1e-6, inWhite - inBlack);
          normalized = Math.max(0, Math.min(1, normalized));
          normalized = Math.pow(normalized, 1 / gamma);
          linearBuf[i + c] = Math.max(0, Math.min(1, outBlack + normalized * (outWhite - outBlack)));
        }
        const pixel = [linearBuf[i], linearBuf[i + 1], linearBuf[i + 2], linearBuf[i + 3]];
        const color = linearPaletteGetColor(palette, pixel, palette.options);
        linearBuf[i] = color[0];
        linearBuf[i + 1] = color[1];
        linearBuf[i + 2] = color[2];
      }
    }

    linearFloatToSrgbBuf(linearBuf, outBuf);
  } else {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let normalized = (i - blackPoint) / inputRange;
      normalized = Math.max(0, Math.min(1, normalized));
      normalized = Math.pow(normalized, 1 / gamma);
      lut[i] = Math.max(0, Math.min(255, Math.round(outputBlack + normalized * outputRange)));
    }

    const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
    const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

    if (wasmIsLoaded() && (options as { _wasmAcceleration?: boolean })._wasmAcceleration !== false) {
      wasmApplyChannelLut(buf, outBuf, lut, lut, lut);
      if (!paletteIsIdentity) {
        for (let i = 0; i < outBuf.length; i += 4) {
          const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
        }
      }
      logFilterWasmStatus("Levels", true, paletteIsIdentity ? "lut" : "lut+palettePass");
    } else {
      logFilterWasmStatus("Levels", false, (options as { _wasmAcceleration?: boolean })._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = getBufferIndex(x, y, W);
          const r = lut[buf[i]];
          const g = lut[buf[i + 1]];
          const b = lut[buf[i + 2]];

          const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter<LevelsOptions>({
  name: "Levels",
  func: levelsFilter,
  optionTypes,
  options: defaults,
  defaults
});
