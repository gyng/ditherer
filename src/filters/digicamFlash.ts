import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  paletteGetColor,
  rgba,
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

const clamp = (min: number, max: number, v: number) => Math.max(min, Math.min(max, v));

export const optionTypes = {
  flashPower: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Flash output strength" },
  falloff: { type: RANGE, range: [0.8, 3], step: 0.05, default: 1.55, desc: "Distance falloff of flash illumination" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal hotspot center" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.44, desc: "Vertical hotspot center" },
  ambient: { type: RANGE, range: [0.4, 1], step: 0.01, default: 0.76, desc: "How much ambient scene light remains outside flash hotspot" },
  edgeBurn: { type: RANGE, range: [0, 1], step: 0.01, default: 0.35, desc: "Darken outer frame to mimic short-range flash falloff" },
  specular: { type: RANGE, range: [0, 1], step: 0.01, default: 0.6, desc: "Extra reflective highlight pop on bright surfaces" },
  whiteClip: { type: RANGE, range: [200, 255], step: 1, default: 242, desc: "Hard clipping point for blown flash highlights" },
  warmth: { type: RANGE, range: [-0.3, 0.3], step: 0.01, default: 0.02, desc: "Flash white-balance tint: warm (+) to cool (-)" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  flashPower: optionTypes.flashPower.default,
  falloff: optionTypes.falloff.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  ambient: optionTypes.ambient.default,
  edgeBurn: optionTypes.edgeBurn.default,
  specular: optionTypes.specular.default,
  whiteClip: optionTypes.whiteClip.default,
  warmth: optionTypes.warmth.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const DF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_center;       // px coords
uniform float u_maxR;
uniform float u_pwr;
uniform float u_falloff;
uniform float u_ambient;
uniform float u_edgeBurn;
uniform float u_specular;
uniform float u_whiteClip;    // 0..1
uniform float u_warmth;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);
  vec3 src = c.rgb * 255.0;

  float dx = x - u_center.x;
  float dy = y - u_center.y;
  float dist = sqrt(dx * dx + dy * dy) / u_maxR;
  float radial = clamp(1.0 - dist, 0.0, 1.0);
  float illum = u_pwr * pow(radial, u_falloff);
  float edgeMask = 1.0 - u_edgeBurn * pow(clamp(dist, 0.0, 1.0), 1.6);
  float exposure = (u_ambient + illum * 1.35) * edgeMask;

  vec3 lit = src * exposure;

  float luma = 0.299 * src.r + 0.587 * src.g + 0.114 * src.b;
  float specBoost = pow(clamp((luma - 118.0) / 137.0, 0.0, 1.0), 2.0) * illum * u_specular * 185.0;
  lit.r += specBoost;
  lit.g += specBoost;
  lit.b += specBoost * 0.95;

  lit.r *= 1.0 + u_warmth * 0.25;
  lit.b *= 1.0 - u_warmth * 0.35;

  float clip255 = u_whiteClip;
  if (lit.r > clip255) lit.r = 255.0;
  if (lit.g > clip255) lit.g = 255.0;
  if (lit.b > clip255) lit.b = 255.0;

  vec3 rgb = clamp(lit, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { df: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    df: linkProgram(gl, DF_FS, [
      "u_source", "u_res", "u_center", "u_maxR", "u_pwr", "u_falloff",
      "u_ambient", "u_edgeBurn", "u_specular", "u_whiteClip",
      "u_warmth", "u_levels",
    ] as const),
  };
  return _cache;
};

const digicamFlash = (input: any, options = defaults) => {
  const {
    flashPower,
    falloff,
    centerX,
    centerY,
    ambient,
    edgeBurn,
    specular,
    whiteClip,
    warmth,
    palette,
  } = options;
  const W = input.width;
  const H = input.height;
  const cx = W * clamp(0, 1, Number(centerX));
  const cy = H * clamp(0, 1, Number(centerY));
  const maxR = Math.max(W, H) * 0.9;
  const pwr = clamp(0, 3, Number(flashPower));
  const distFalloff = clamp(0.5, 4, Number(falloff));
  const amb = clamp(0.2, 1.2, Number(ambient));
  const edge = clamp(0, 1, Number(edgeBurn));
  const spec = clamp(0, 1, Number(specular));
  const clip = clamp(180, 255, Number(whiteClip));
  const warm = clamp(-0.5, 0.5, Number(warmth));

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "digicamFlash:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.df, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.df.uniforms.u_source, 0);
        gl.uniform2f(cache.df.uniforms.u_res, W, H);
        gl.uniform2f(cache.df.uniforms.u_center, cx, cy);
        gl.uniform1f(cache.df.uniforms.u_maxR, maxR);
        gl.uniform1f(cache.df.uniforms.u_pwr, pwr);
        gl.uniform1f(cache.df.uniforms.u_falloff, distFalloff);
        gl.uniform1f(cache.df.uniforms.u_ambient, amb);
        gl.uniform1f(cache.df.uniforms.u_edgeBurn, edge);
        gl.uniform1f(cache.df.uniforms.u_specular, spec);
        gl.uniform1f(cache.df.uniforms.u_whiteClip, clip);
        gl.uniform1f(cache.df.uniforms.u_warmth, warm);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.df.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Digicam Flash", "WebGL2",
            `pwr=${flashPower}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Digicam Flash", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
      const radial = clamp(0, 1, 1 - dist);
      const illum = pwr * Math.pow(radial, distFalloff);
      const edgeMask = 1 - edge * Math.pow(clamp(0, 1, dist), 1.6);
      const exposure = (amb + illum * 1.35) * edgeMask;

      let r = buf[i] * exposure;
      let g = buf[i + 1] * exposure;
      let b = buf[i + 2] * exposure;

      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const specBoost = Math.pow(clamp(0, 1, (luma - 118) / 137), 2) * illum * spec * 185;
      r += specBoost;
      g += specBoost;
      b += specBoost * 0.95;

      r *= 1 + warm * 0.25;
      b *= 1 - warm * 0.35;

      if (r > clip) r = 255;
      if (g > clip) g = 255;
      if (b > clip) b = 255;

      const color = paletteGetColor(
        palette,
        rgba(clamp(0, 255, r), clamp(0, 255, g), clamp(0, 255, b), buf[i + 3]),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Digicam Flash",
  func: digicamFlash,
  optionTypes,
  options: defaults,
  defaults,
  description: "On-camera point-and-shoot flash look with center hotspot, rapid falloff, reflective clipping, and edge burn",
});
