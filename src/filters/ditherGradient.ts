import { RANGE, COLOR, PALETTE, ENUM } from "constants/controlTypes";
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

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const STYLE = {
  PRINT: "PRINT",
  DREAMY: "DREAMY",
};

export const optionTypes = {
  color1: { type: COLOR, default: [28, 18, 12], desc: "Start color of the gradient" },
  color2: { type: COLOR, default: [246, 214, 132], desc: "End color of the gradient" },
  angle: { type: RANGE, range: [0, 360], step: 5, default: 35, desc: "Gradient direction in degrees" },
  style: {
    type: ENUM,
    options: [
      { name: "Poster / Print", value: STYLE.PRINT },
      { name: "Dreamy / Color Map", value: STYLE.DREAMY },
    ],
    default: STYLE.PRINT,
    desc: "Treat the source as either graphic print structure or a dreamy color-mapped guide",
  },
  amount: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "How strongly the ordered dither pattern perturbs the gradient before quantization" },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.75, desc: "How much the source luminance remaps the generated gradient" },
  detailInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "How much source edges intensify local dither contrast" },
  sourceColorMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "How much source color tints the gradient result", visibleWhen: (options: any) => options.style === STYLE.DREAMY },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  color1: optionTypes.color1.default,
  color2: optionTypes.color2.default,
  angle: optionTypes.angle.default,
  style: optionTypes.style.default,
  amount: optionTypes.amount.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  detailInfluence: optionTypes.detailInfluence.default,
  sourceColorMix: optionTypes.sourceColorMix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const STYLE_ID: Record<string, number> = { PRINT: 0, DREAMY: 1 };

const DITHER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec3  u_color1;
uniform vec3  u_color2;
uniform float u_cosA;
uniform float u_sinA;
uniform float u_minProj;
uniform float u_range;
uniform int   u_style;        // 0 PRINT, 1 DREAMY
uniform float u_amount;
uniform float u_sourceInfluence;
uniform float u_detailInfluence;
uniform float u_sourceColorMix;

const float BAYER[16] = float[16](
  0.0,  8.0,  2.0, 10.0,
  12.0, 4.0, 14.0,  6.0,
  3.0, 11.0,  1.0,  9.0,
  15.0, 7.0, 13.0,  5.0
);

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 onePx = 1.0 / u_res;
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);

  vec3 srcRGB = texture(u_source, suv).rgb;
  float srcLuma = lum(srcRGB);

  vec3 l = texture(u_source, suv - vec2(onePx.x, 0.0)).rgb;
  vec3 r = texture(u_source, suv + vec2(onePx.x, 0.0)).rgb;
  vec3 d = texture(u_source, suv - vec2(0.0, onePx.y)).rgb;
  vec3 t = texture(u_source, suv + vec2(0.0, onePx.y)).rgb;
  float neighborAvg = (lum(l) + lum(r) + lum(d) + lum(t)) * 0.25;
  float edge = clamp(abs(srcLuma - neighborAvg) * 3.0, 0.0, 1.0);

  float proj = x * u_cosA + y * u_sinA;
  float baseT = (proj - u_minProj) / u_range;
  float warpedT = u_style == 0
    ? clamp(baseT * (1.0 - u_sourceInfluence) + srcLuma * u_sourceInfluence, 0.0, 1.0)
    : clamp(baseT * (1.0 - u_sourceInfluence * 0.65) + srcLuma * u_sourceInfluence * 0.65 + edge * 0.12, 0.0, 1.0);

  vec3 rgb = mix(u_color1, u_color2, warpedT);

  if (u_style == 1) {
    float tintMix = u_sourceColorMix * (0.55 + edge * 0.45);
    float haze = 0.12 + u_sourceInfluence * 0.1;
    vec3 src255 = srcRGB * 255.0;
    rgb = rgb * (1.0 - tintMix) + src255 * tintMix
        + vec3(255.0 * haze * 0.35, 255.0 * haze * 0.22, 255.0 * haze * 0.5);
  } else {
    float contrast = 1.15 + edge * u_detailInfluence * 1.4;
    rgb = (rgb - 127.5) * contrast + 127.5;
  }

  int bx = int(mod(x, 4.0));
  int by = int(mod(y, 4.0));
  float threshold = (BAYER[by * 4 + bx] + 0.5) / 16.0 - 0.5;
  float ditherBias = u_style == 0
    ? threshold * 255.0 * u_amount * (1.0 + edge * u_detailInfluence * 2.0)
    : threshold * 255.0 * u_amount * (0.55 + edge * u_detailInfluence);

  rgb = clamp(rgb + ditherBias, 0.0, 255.0) / 255.0;
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { dither: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    dither: linkProgram(gl, DITHER_FS, [
      "u_source", "u_res", "u_color1", "u_color2", "u_cosA", "u_sinA",
      "u_minProj", "u_range", "u_style", "u_amount", "u_sourceInfluence",
      "u_detailInfluence", "u_sourceColorMix",
    ] as const),
  };
  return _cache;
};

const ditherGradient = (input: any, options: any = defaults) => {
  const {
    color1,
    color2,
    angle,
    style = defaults.style,
    amount,
    sourceInfluence,
    detailInfluence,
    sourceColorMix = defaults.sourceColorMix,
    palette,
  } = options;
  const W = input.width, H = input.height;

  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  let minProj = Infinity, maxProj = -Infinity;
  for (const [cx, cy] of corners) {
    const proj = cx * cosA + cy * sinA;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const range = maxProj - minProj || 1;

  if (glAvailable() && (options._webglAcceleration) !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "ditherGradient:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.dither, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.dither.uniforms.u_source, 0);
        gl.uniform2f(cache.dither.uniforms.u_res, W, H);
        gl.uniform3f(cache.dither.uniforms.u_color1, color1[0], color1[1], color1[2]);
        gl.uniform3f(cache.dither.uniforms.u_color2, color2[0], color2[1], color2[2]);
        gl.uniform1f(cache.dither.uniforms.u_cosA, cosA);
        gl.uniform1f(cache.dither.uniforms.u_sinA, sinA);
        gl.uniform1f(cache.dither.uniforms.u_minProj, minProj);
        gl.uniform1f(cache.dither.uniforms.u_range, range);
        gl.uniform1i(cache.dither.uniforms.u_style, STYLE_ID[style] ?? 0);
        gl.uniform1f(cache.dither.uniforms.u_amount, amount);
        gl.uniform1f(cache.dither.uniforms.u_sourceInfluence, sourceInfluence);
        gl.uniform1f(cache.dither.uniforms.u_detailInfluence, detailInfluence);
        gl.uniform1f(cache.dither.uniforms.u_sourceColorMix, sourceColorMix);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Dither Gradient", "WebGL2",
            `${style}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Dither Gradient", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const src = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(W * H * 4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const proj = x * cosA + y * sinA;
      const baseT = (proj - minProj) / range;
      const i = getBufferIndex(x, y, W);
      const srcLuma = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;
      const leftI = getBufferIndex(Math.max(0, x - 1), y, W);
      const rightI = getBufferIndex(Math.min(W - 1, x + 1), y, W);
      const upI = getBufferIndex(x, Math.max(0, y - 1), W);
      const downI = getBufferIndex(x, Math.min(H - 1, y + 1), W);
      const neighborAvg = (
        0.2126 * src[leftI] + 0.7152 * src[leftI + 1] + 0.0722 * src[leftI + 2] +
        0.2126 * src[rightI] + 0.7152 * src[rightI + 1] + 0.0722 * src[rightI + 2] +
        0.2126 * src[upI] + 0.7152 * src[upI + 1] + 0.0722 * src[upI + 2] +
        0.2126 * src[downI] + 0.7152 * src[downI + 1] + 0.0722 * src[downI + 2]
      ) / (255 * 4);
      const edge = Math.min(1, Math.abs(srcLuma - neighborAvg) * 3);
      const warpedT = style === STYLE.PRINT
        ? Math.max(0, Math.min(1, baseT * (1 - sourceInfluence) + srcLuma * sourceInfluence))
        : Math.max(0, Math.min(1, baseT * (1 - sourceInfluence * 0.65) + srcLuma * sourceInfluence * 0.65 + edge * 0.12));

      let r = color1[0] + (color2[0] - color1[0]) * warpedT;
      let g = color1[1] + (color2[1] - color1[1]) * warpedT;
      let b = color1[2] + (color2[2] - color1[2]) * warpedT;

      if (style === STYLE.DREAMY) {
        const tintMix = sourceColorMix * (0.55 + edge * 0.45);
        const haze = 0.12 + sourceInfluence * 0.1;
        r = r * (1 - tintMix) + src[i] * tintMix + 255 * haze * 0.35;
        g = g * (1 - tintMix) + src[i + 1] * tintMix + 255 * haze * 0.22;
        b = b * (1 - tintMix) + src[i + 2] * tintMix + 255 * haze * 0.5;
      } else {
        const contrast = 1.15 + edge * detailInfluence * 1.4;
        r = (r - 127.5) * contrast + 127.5;
        g = (g - 127.5) * contrast + 127.5;
        b = (b - 127.5) * contrast + 127.5;
      }

      const threshold = (BAYER_4X4[y % 4][x % 4] + 0.5) / 16 - 0.5;
      const ditherBias = style === STYLE.PRINT
        ? threshold * 255 * amount * (1 + edge * detailInfluence * 2)
        : threshold * 255 * amount * (0.55 + edge * detailInfluence);

      const color = paletteGetColor(
        palette,
        rgba(
          Math.max(0, Math.min(255, Math.round(r + ditherBias))),
          Math.max(0, Math.min(255, Math.round(g + ditherBias))),
          Math.max(0, Math.min(255, Math.round(b + ditherBias))),
          255
        ),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Dither Gradient", func: ditherGradient, optionTypes, options: defaults, defaults, description: "Map a gradient through the source image's luminance and edge structure, then ordered-dither the result" });
