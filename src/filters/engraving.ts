import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
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
  lineSpacing: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Distance between engraved lines" },
  angle: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "Line angle in degrees" },
  inkColor: { type: COLOR, default: [10, 10, 20], desc: "Engraved line color" },
  paperColor: { type: COLOR, default: [250, 245, 235], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lineSpacing: optionTypes.lineSpacing.default,
  angle: optionTypes.angle.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const ENGRAVE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_lineSpacing;
uniform float u_cosA;
uniform float u_sinA;
uniform vec3  u_inkColor;     // 0..1
uniform vec3  u_paperColor;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec3 src = texture(u_source, suv).rgb;
  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float darkness = 1.0 - lum;

  float proj = x * u_cosA + y * u_sinA;
  float linePos = mod(proj, u_lineSpacing);
  if (linePos < 0.0) linePos += u_lineSpacing;

  float lineThickness = darkness * u_lineSpacing * 0.8;
  float distToCenter = abs(linePos - u_lineSpacing * 0.5);

  vec3 rgb = u_paperColor;
  if (distToCenter < lineThickness * 0.5) {
    float t = 1.0 - distToCenter / max(lineThickness * 0.5, 1e-5);
    float inkIntensity = t * t * darkness;
    rgb = mix(u_paperColor, u_inkColor, inkIntensity);
  }
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { eng: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    eng: linkProgram(gl, ENGRAVE_FS, [
      "u_source", "u_res", "u_lineSpacing", "u_cosA", "u_sinA",
      "u_inkColor", "u_paperColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const engraving = (input: any, options = defaults) => {
  const { lineSpacing, angle, inkColor, paperColor, palette } = options;
  const W = input.width, H = input.height;
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "engraving:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.eng, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.eng.uniforms.u_source, 0);
        gl.uniform2f(cache.eng.uniforms.u_res, W, H);
        gl.uniform1f(cache.eng.uniforms.u_lineSpacing, lineSpacing);
        gl.uniform1f(cache.eng.uniforms.u_cosA, cosA);
        gl.uniform1f(cache.eng.uniforms.u_sinA, sinA);
        gl.uniform3f(cache.eng.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
        gl.uniform3f(cache.eng.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.eng.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Engraving", "WebGL2",
            `spacing=${lineSpacing}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Engraving", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      const darkness = 1 - lum;

      const proj = x * cosA + y * sinA;
      const linePos = ((proj % lineSpacing) + lineSpacing) % lineSpacing;

      const lineThickness = darkness * lineSpacing * 0.8;
      const distToCenter = Math.abs(linePos - lineSpacing / 2);
      const onLine = distToCenter < lineThickness / 2;

      if (onLine) {
        const t = 1 - distToCenter / (lineThickness / 2);
        const inkIntensity = t * t * darkness;
        const r = Math.round(paperColor[0] + (inkColor[0] - paperColor[0]) * inkIntensity);
        const g = Math.round(paperColor[1] + (inkColor[1] - paperColor[1]) * inkIntensity);
        const b = Math.round(paperColor[2] + (inkColor[2] - paperColor[2]) * inkIntensity);
        const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      } else {
        const color = paletteGetColor(palette, rgba(paperColor[0], paperColor[1], paperColor[2], 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Engraving", func: engraving, optionTypes, options: defaults, defaults });
