import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { THEMES } from "../palettes/user";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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
} from "../gl/index";
import { fixedPrintPlateOffset, stencilInkVariation } from "./printSimulationContracts";

export const optionTypes = {
  color1: { type: COLOR, default: THEMES.RISOGRAPH[1].slice(0, 3), desc: "First ink color" },
  color2: { type: COLOR, default: THEMES.RISOGRAPH[2].slice(0, 3), desc: "Second ink color" },
  color3: { type: COLOR, default: THEMES.RISOGRAPH[4].slice(0, 3), desc: "Third ink color" },
  color4: { type: COLOR, default: THEMES.RISOGRAPH[3].slice(0, 3), desc: "Fourth ink color" },
  layers: { type: RANGE, range: [2, 4], step: 1, default: 3, desc: "Number of ink layers to print" },
  misregistration: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Print alignment error in pixels" },
  grain: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Paper texture grain amount" },
  palette: { type: PALETTE, default: nearest, desc: "Optional palette applied after the fixed spot-ink layers" }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  color3: optionTypes.color3.default,
  color4: optionTypes.color4.default,
  layers: optionTypes.layers.default,
  misregistration: optionTypes.misregistration.default,
  grain: optionTypes.grain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const RISO_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_layers;
uniform float u_grain;
uniform vec3  u_inkColor[4];
uniform vec2  u_inkOffset[4];

float hash(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p, float layer) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i, layer);
  float b = hash(i + vec2(1.0, 0.0), layer);
  float c = hash(i + vec2(0.0, 1.0), layer);
  float d = hash(i + vec2(1.0, 1.0), layer);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float stencilVariation(vec2 p, float layer) {
  return clamp((vnoise(p / 3.5, layer) - 0.5) * 0.65
    + (vnoise(p / vec2(13.0, 11.0) + vec2(17.0, 29.0), layer + 11.0) - 0.5) * 0.35,
    -0.5, 0.5);
}

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

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

  vec3 rgb = vec3(245.0, 240.0, 235.0) / 255.0;

  for (int li = 0; li < 4; li++) {
    if (li >= u_layers) break;
    float thresh = (float(li) + 1.0) / (float(u_layers) + 1.0);
    vec2 off = u_inkOffset[li];
    float sx = x - off.x;
    float sy = y - off.y;
    if (sx < 0.0 || sx >= u_res.x || sy < 0.0 || sy >= u_res.y) continue;
    float l = lum(samplePx(sx, sy));
    float bandDist = abs(l - thresh);
    if (bandDist > 0.3) continue;

    float intensity = max(0.0, (0.3 - bandDist) / 0.3) * 0.7;
    float n = u_grain > 0.0 ? stencilVariation(vec2(x, y), float(li)) * u_grain * 0.3 : 0.0;
    float ink = clamp(intensity + n, 0.0, 1.0);

    rgb = rgb * (1.0 - ink) + u_inkColor[li] * ink;
  }
  vec2 sourceUv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), texture(u_source, sourceUv).a);
}
`;

type Cache = { riso: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    riso: linkProgram(gl, RISO_FS, [
      "u_source", "u_res", "u_layers", "u_grain", "u_inkColor", "u_inkOffset",
    ] as const),
  };
  return _cache;
};

const risographMulti = (input: any, options: Partial<typeof defaults> = defaults) => {
  const { color1, color2, color3, color4, layers, misregistration, grain, palette } = { ...defaults, ...options };
  const W = input.width;
  const H = input.height;

  // Precompute per-layer misregistration offsets on CPU so the shader has
  // them as plain uniforms and the RNG call order matches the JS path.
  const colors = [color1, color2, color3, color4];
  const offsets: Array<[number, number]> = [];
  for (let li = 0; li < layers; li++) {
    offsets.push(fixedPrintPlateOffset(li, layers, misregistration));
  }
  while (offsets.length < 4) offsets.push([0, 0]);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "risographMulti:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const colorArr = new Float32Array(4 * 3);
      const offArr = new Float32Array(4 * 2);
      for (let i = 0; i < 4; i++) {
        const c = colors[i] ?? [0, 0, 0];
        colorArr[i * 3] = c[0] / 255;
        colorArr[i * 3 + 1] = c[1] / 255;
        colorArr[i * 3 + 2] = c[2] / 255;
        offArr[i * 2] = offsets[i][0];
        offArr[i * 2 + 1] = offsets[i][1];
      }

      drawPass(gl, null, W, H, cache.riso, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.riso.uniforms.u_source, 0);
        gl.uniform2f(cache.riso.uniforms.u_res, W, H);
        gl.uniform1i(cache.riso.uniforms.u_layers, layers);
        gl.uniform1f(cache.riso.uniforms.u_grain, grain);
        gl.uniform3fv(cache.riso.uniforms.u_inkColor, colorArr);
        gl.uniform2fv(cache.riso.uniforms.u_inkOffset, offArr);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Risograph (multi-layer)", "WebGL2",
            `layers=${layers}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Risograph (multi-layer)", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    }

  for (let i = 0; i < outBuf.length; i += 4) { outBuf[i] = 245; outBuf[i + 1] = 240; outBuf[i + 2] = 235; outBuf[i + 3] = buf[i + 3]; }

  const activeColors = colors.slice(0, layers);
  const thresholds = activeColors.map((_, i) => (i + 1) / (activeColors.length + 1));

  for (let li = 0; li < activeColors.length; li++) {
    const c = activeColors[li];
    const thresh = thresholds[li];
    const [offX, offY] = offsets[li];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcX = x - offX;
        const srcY = y - offY;
        if (srcX < 0 || srcX >= W || srcY < 0 || srcY >= H) continue;
        const l = lum[srcY * W + srcX];

        const bandDist = Math.abs(l - thresh);
        if (bandDist > 0.3) continue;

        const intensity = Math.max(0, (0.3 - bandDist) / 0.3) * 0.7;
        const n = grain > 0 ? stencilInkVariation(x, y, li) * grain * 0.3 : 0;
        const ink = Math.max(0, Math.min(1, intensity + n));

        const i = getBufferIndex(x, y, W);
        outBuf[i] = Math.round(outBuf[i] * (1 - ink) + c[0] * ink);
        outBuf[i + 1] = Math.round(outBuf[i + 1] * (1 - ink) + c[1] * ink);
        outBuf[i + 2] = Math.round(outBuf[i + 2] * (1 - ink) + c[2] * ink);
      }
    }
  }

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Risograph (multi-layer)",
  func: risographMulti,
  optionTypes,
  options: defaults,
  defaults,
  description: "Fixed multi-master stencil print with balanced registration offsets and correlated emulsion-ink variation",
});
