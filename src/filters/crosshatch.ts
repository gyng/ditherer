import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
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

export const optionTypes = {
  density: { type: RANGE, range: [2, 20], step: 1, default: 6, desc: "Line spacing in pixels" },
  angle1: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "First hatch direction in degrees" },
  angle2: { type: RANGE, range: [0, 180], step: 5, default: 135, desc: "Second hatch direction in degrees" },
  threshold1: { type: RANGE, range: [0, 255], step: 1, default: 170, desc: "Luminance below which first hatch appears" },
  threshold2: { type: RANGE, range: [0, 255], step: 1, default: 100, desc: "Luminance below which second hatch appears" },
  lineWidth: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Hatch line thickness" },
  inkColor: { type: COLOR, default: [0, 0, 0], desc: "Hatch line color" },
  paperColor: { type: COLOR, default: [255, 255, 240], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  angle1: optionTypes.angle1.default,
  angle2: optionTypes.angle2.default,
  threshold1: optionTypes.threshold1.default,
  threshold2: optionTypes.threshold2.default,
  lineWidth: optionTypes.lineWidth.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const CH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_density;
uniform float u_lineWidth;
uniform float u_threshold1;   // 0..255
uniform float u_threshold2;
uniform float u_cos1;
uniform float u_sin1;
uniform float u_cos2;
uniform float u_sin2;
uniform vec3  u_inkColor;     // 0..1
uniform vec3  u_paperColor;   // 0..1
uniform float u_levels;

bool onLine(float x, float y, float cs, float sn) {
  float proj = x * cs + y * sn;
  float m = mod(proj, u_density);
  if (m < 0.0) m += u_density;
  return m < u_lineWidth;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec3 src = texture(u_source, suv).rgb;
  float lum = (0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b) * 255.0;

  vec3 rgb = u_paperColor;
  if (lum < u_threshold1 && onLine(x, y, u_cos1, u_sin1)) rgb = u_inkColor;
  if (lum < u_threshold2 && onLine(x, y, u_cos2, u_sin2)) rgb = u_inkColor;

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { ch: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ch: linkProgram(gl, CH_FS, [
      "u_source", "u_res", "u_density", "u_lineWidth",
      "u_threshold1", "u_threshold2", "u_cos1", "u_sin1", "u_cos2", "u_sin2",
      "u_inkColor", "u_paperColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const crosshatch = (input: any, options = defaults) => {
  const { density, angle1, angle2, threshold1, threshold2, lineWidth, inkColor, paperColor, palette } = options;
  const W = input.width;
  const H = input.height;
  const rad1 = (angle1 * Math.PI) / 180;
  const rad2 = (angle2 * Math.PI) / 180;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "crosshatch:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ch, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ch.uniforms.u_source, 0);
        gl.uniform2f(cache.ch.uniforms.u_res, W, H);
        gl.uniform1f(cache.ch.uniforms.u_density, density);
        gl.uniform1f(cache.ch.uniforms.u_lineWidth, lineWidth);
        gl.uniform1f(cache.ch.uniforms.u_threshold1, threshold1);
        gl.uniform1f(cache.ch.uniforms.u_threshold2, threshold2);
        gl.uniform1f(cache.ch.uniforms.u_cos1, Math.cos(rad1));
        gl.uniform1f(cache.ch.uniforms.u_sin1, Math.sin(rad1));
        gl.uniform1f(cache.ch.uniforms.u_cos2, Math.cos(rad2));
        gl.uniform1f(cache.ch.uniforms.u_sin2, Math.sin(rad2));
        gl.uniform3f(cache.ch.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
        gl.uniform3f(cache.ch.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.ch.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Crosshatch", "WebGL2",
            `density=${density}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Crosshatch", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      fillBufferPixel(outBuf, i, paperColor[0], paperColor[1], paperColor[2], 255);
    }
  }

  const drawHatch = (angleDeg: number, threshold: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (lum[y * W + x] >= threshold) continue;

        const proj = x * cosA + y * sinA;
        const distToLine = ((proj % density) + density) % density;

        if (distToLine < lineWidth) {
          const i = getBufferIndex(x, y, W);
          const color = paletteGetColor(palette, rgba(inkColor[0], inkColor[1], inkColor[2], 255), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
        }
      }
    }
  };

  drawHatch(angle1, threshold1);
  drawHatch(angle2, threshold2);

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Crosshatch",
  func: crosshatch,
  optionTypes,
  options: defaults,
  defaults
});
