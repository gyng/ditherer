import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  rgba2hsva,
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
  bandCount: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Number of hue families to divide the image into" },
  hueOffset: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Rotate the hue-band mapping around the color wheel" },
  preserveLuma: { type: BOOL, default: true, desc: "Keep the original luminance while remapping only the hue family" },
  saturationBoost: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Boost or reduce the remapped palette color saturation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bandCount: optionTypes.bandCount.default,
  hueOffset: optionTypes.hueOffset.default,
  preserveLuma: optionTypes.preserveLuma.default,
  saturationBoost: optionTypes.saturationBoost.default,
  palette: { ...optionTypes.palette.default, options: { levels: 16 } }
};

type PaletteMapperPalette = typeof defaults.palette;

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const buildBandPalette = (bandCount: number, hueOffset: number, palette: PaletteMapperPalette) => {
  const colors: number[][] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const hue = (((band / bandCount) * 360 + hueOffset) % 360 + 360) % 360;
    const base = paletteGetColor(
      palette,
      rgba(
        clamp255((Math.sin((hue / 180) * Math.PI) * 0.5 + 0.5) * 255),
        clamp255((Math.sin(((hue + 120) / 180) * Math.PI) * 0.5 + 0.5) * 255),
        clamp255((Math.sin(((hue + 240) / 180) * Math.PI) * 0.5 + 0.5) * 255),
        255
      ),
      palette.options,
      false
    );
    colors.push([base[0], base[1], base[2]]);
  }
  return colors;
};

const MAPPER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_bandCount;
uniform float u_hueOffset;
uniform int   u_preserveLuma;
uniform float u_saturationBoost;
uniform vec3  u_bands[16];

// RGB → HSV (hue in degrees, sat/val in [0,1]).
vec3 rgb2hsv(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-5) {
    if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = ((c.b - c.r) / d) + 2.0;
    else                h = ((c.r - c.g) / d) + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  float s = mx > 1e-5 ? d / mx : 0.0;
  return vec3(h, s, mx);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 srcA = texture(u_source, suv);
  vec3 src = srcA.rgb;

  vec3 hsv = rgb2hsv(src);
  float shifted = mod(hsv.x - u_hueOffset, 360.0);
  if (shifted < 0.0) shifted += 360.0;
  int bandIndex = int(min(float(u_bandCount) - 1.0, floor(shifted / 360.0 * float(u_bandCount))));

  vec3 target = u_bands[0];
  for (int i = 0; i < 16; i++) {
    if (i == bandIndex) target = u_bands[i];
  }

  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  vec3 out3 = target;
  if (u_preserveLuma == 1) {
    float gray = max(0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b, 1.0 / 255.0);
    out3 = target * (lum / gray);
  }
  float satMix = hsv.y * u_saturationBoost;
  float center = (out3.r + out3.g + out3.b) / 3.0;
  out3 = mix(vec3(center), out3, satMix);

  fragColor = vec4(clamp(out3, 0.0, 1.0), srcA.a);
}
`;

type Cache = { mapper: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    mapper: linkProgram(gl, MAPPER_FS, [
      "u_source", "u_res", "u_bandCount", "u_hueOffset",
      "u_preserveLuma", "u_saturationBoost", "u_bands",
    ] as const),
  };
  return _cache;
};

const paletteMapper = (input: any, options = defaults) => {
  const { bandCount, hueOffset, preserveLuma, saturationBoost, palette } = options;
  const width = input.width;
  const height = input.height;
  const bandColors = buildBandPalette(bandCount, hueOffset, palette);

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, width, height);
      const sourceTex = ensureTexture(gl, "paletteMapper:source", width, height);
      uploadSourceTexture(gl, sourceTex, input);

      // Pack bandColors into a 16-entry array (pad with last colour).
      const bands = new Float32Array(16 * 3);
      for (let i = 0; i < 16; i++) {
        const c = bandColors[Math.min(i, bandColors.length - 1)];
        bands[i * 3] = c[0] / 255;
        bands[i * 3 + 1] = c[1] / 255;
        bands[i * 3 + 2] = c[2] / 255;
      }

      drawPass(gl, null, width, height, cache.mapper, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.mapper.uniforms.u_source, 0);
        gl.uniform2f(cache.mapper.uniforms.u_res, width, height);
        gl.uniform1i(cache.mapper.uniforms.u_bandCount, bandCount);
        gl.uniform1f(cache.mapper.uniforms.u_hueOffset, hueOffset);
        gl.uniform1i(cache.mapper.uniforms.u_preserveLuma, preserveLuma ? 1 : 0);
        gl.uniform1f(cache.mapper.uniforms.u_saturationBoost, saturationBoost);
        gl.uniform3fv(cache.mapper.uniforms.u_bands, bands);
      }, vao);

      const rendered = readoutToCanvas(canvas, width, height);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
        if (out) {
          logFilterBackend("Palette Mapper", "WebGL2",
            `bands=${bandCount}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Palette Mapper", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];
      const hsv = rgba2hsva([r, g, b, a]);
      const hue = Number.isFinite(hsv[0]) ? hsv[0] : 0;
      const sat = hsv[1];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const shiftedHue = (((hue - hueOffset) % 360) + 360) % 360;
      const bandIndex = Math.min(bandCount - 1, Math.floor((shiftedHue / 360) * bandCount));
      const target = bandColors[bandIndex];

      const gray = (target[0] * 0.2126 + target[1] * 0.7152 + target[2] * 0.0722) || 1;
      let rr = target[0];
      let gg = target[1];
      let bb = target[2];

      if (preserveLuma) {
        const scale = (lum * 255) / gray;
        rr *= scale;
        gg *= scale;
        bb *= scale;
      }

      const satMix = sat * saturationBoost;
      const center = (rr + gg + bb) / 3;
      rr = lerp(center, rr, satMix);
      gg = lerp(center, gg, satMix);
      bb = lerp(center, bb, satMix);

      const color = paletteGetColor(
        palette,
        rgba(clamp255(rr), clamp255(gg), clamp255(bb), a),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Palette Mapper",
  func: paletteMapper,
  options: defaults,
  optionTypes,
  defaults,
  description: "Remap hue families into fixed palette slots while optionally preserving the original lightness"
});
