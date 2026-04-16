import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { THEMES } from "palettes/user";
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
  plates: { type: RANGE, range: [2, 4], step: 1, default: 3, desc: "Number of spot-color plates to layer" },
  offset: { type: RANGE, range: [0, 24], step: 1, default: 6, desc: "Maximum misregistration offset between plates in pixels" },
  angleJitter: { type: RANGE, range: [0, 45], step: 1, default: 12, desc: "Randomize each plate's shift direction by this many degrees" },
  paperColor: { type: COLOR, default: [244, 237, 224], desc: "Base paper stock color under the inks" },
  inkStrength: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.75, desc: "Opacity of each spot-color layer" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  plates: optionTypes.plates.default,
  offset: optionTypes.offset.default,
  angleJitter: optionTypes.angleJitter.default,
  paperColor: optionTypes.paperColor.default,
  inkStrength: optionTypes.inkStrength.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const SPOT_COLORS = [
  THEMES.RISOGRAPH[1].slice(0, 3),
  THEMES.RISOGRAPH[2].slice(0, 3),
  THEMES.RISOGRAPH[4].slice(0, 3),
  THEMES.RISOGRAPH[3].slice(0, 3)
];

const SP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_plates;
uniform vec3  u_paper;         // paper colour 0..1
uniform float u_inkStrength;
uniform vec3  u_plateColor[4]; // 0..1
uniform vec2  u_plateOffset[4];

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

  vec3 rgb = u_paper;
  for (int p = 0; p < 4; p++) {
    if (p >= u_plates) break;
    vec2 off = u_plateOffset[p];
    vec3 src = samplePx(x - off.x, y - off.y);
    float plateLuma;
    if (p == 0)      plateLuma = 1.0 - src.r;
    else if (p == 1) plateLuma = 1.0 - src.g;
    else if (p == 2) plateLuma = 1.0 - src.b;
    else             plateLuma = 1.0 - (0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b);

    float ink = clamp(plateLuma * u_inkStrength, 0.0, 1.0);
    if (ink > 0.01) {
      rgb = rgb * (1.0 - ink) + u_plateColor[p] * ink;
    }
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { sp: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    sp: linkProgram(gl, SP_FS, [
      "u_source", "u_res", "u_plates", "u_paper", "u_inkStrength",
      "u_plateColor", "u_plateOffset",
    ] as const),
  };
  return _cache;
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const sampleChannel = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number) => {
  const sx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return data[getBufferIndex(sx, sy, width) + channel];
};

const screenPrint = (input: any, options = defaults) => {
  const { plates, offset, angleJitter, paperColor, inkStrength, palette } = options;
  const width = input.width;
  const height = input.height;
  const activeColors = SPOT_COLORS.slice(0, plates);

  const plateOffsets: Array<[number, number]> = activeColors.map((_, p) => {
    const baseAngle = (Math.PI * 2 * p) / activeColors.length;
    const jitterAngle = (angleJitter * Math.PI) / 180;
    const theta = baseAngle + (p % 2 === 0 ? 1 : -1) * jitterAngle;
    return [
      Math.cos(theta) * offset * (0.5 + p * 0.25),
      Math.sin(theta) * offset * (0.5 + p * 0.25),
    ];
  });

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, width, height);
      const sourceTex = ensureTexture(gl, "screenPrint:source", width, height);
      uploadSourceTexture(gl, sourceTex, input);

      const colorArr = new Float32Array(4 * 3);
      const offsetArr = new Float32Array(4 * 2);
      for (let p = 0; p < activeColors.length; p++) {
        colorArr[p * 3] = activeColors[p][0] / 255;
        colorArr[p * 3 + 1] = activeColors[p][1] / 255;
        colorArr[p * 3 + 2] = activeColors[p][2] / 255;
        offsetArr[p * 2] = plateOffsets[p][0];
        offsetArr[p * 2 + 1] = plateOffsets[p][1];
      }

      drawPass(gl, null, width, height, cache.sp, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.sp.uniforms.u_source, 0);
        gl.uniform2f(cache.sp.uniforms.u_res, width, height);
        gl.uniform1i(cache.sp.uniforms.u_plates, activeColors.length);
        gl.uniform3f(cache.sp.uniforms.u_paper, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        gl.uniform1f(cache.sp.uniforms.u_inkStrength, inkStrength);
        gl.uniform3fv(cache.sp.uniforms.u_plateColor, colorArr);
        gl.uniform2fv(cache.sp.uniforms.u_plateOffset, offsetArr);
      }, vao);

      const rendered = readoutToCanvas(canvas, width, height);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
        if (out) {
          logFilterBackend("Screen Print", "WebGL2",
            `plates=${plates}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Screen Print", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paperColor[0];
    outBuf[i + 1] = paperColor[1];
    outBuf[i + 2] = paperColor[2];
    outBuf[i + 3] = 255;
  }

  for (let p = 0; p < activeColors.length; p += 1) {
    const plateColor = activeColors[p];
    const [offX, offY] = plateOffsets[p];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const srcR = sampleChannel(buf, width, height, x - offX, y - offY, 0);
        const srcG = sampleChannel(buf, width, height, x - offX, y - offY, 1);
        const srcB = sampleChannel(buf, width, height, x - offX, y - offY, 2);

        const plateLuma = p === 0
          ? 1 - srcR / 255
          : p === 1
            ? 1 - srcG / 255
            : p === 2
              ? 1 - srcB / 255
              : 1 - (srcR * 0.2126 + srcG * 0.7152 + srcB * 0.0722) / 255;

        const ink = Math.max(0, Math.min(1, plateLuma * inkStrength));
        if (ink <= 0.01) continue;

        const i = getBufferIndex(x, y, width);
        outBuf[i] = clamp255(outBuf[i] * (1 - ink) + plateColor[0] * ink);
        outBuf[i + 1] = clamp255(outBuf[i + 1] * (1 - ink) + plateColor[1] * ink);
        outBuf[i + 2] = clamp255(outBuf[i + 2] * (1 - ink) + plateColor[2] * ink);
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const color = paletteGetColor(
        palette,
        rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Screen Print",
  func: screenPrint,
  options: defaults,
  optionTypes,
  defaults,
  description: "Layer a few flat spot-color plates with visible misregistration for a silkscreen poster look"
});
