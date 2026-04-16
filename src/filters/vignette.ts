import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
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

const SHAPE = { CIRCLE: "CIRCLE", ELLIPSE: "ELLIPSE" };

export const optionTypes = {
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Maximum darkening amount at the edges" },
  radius: { type: RANGE, range: [0.2, 1.5], step: 0.05, default: 0.8, desc: "Distance from center where darkening begins" },
  softness: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.4, desc: "Width of the transition zone between clear and dark" },
  shape: {
    type: ENUM,
    options: [
      { name: "Circle", value: SHAPE.CIRCLE },
      { name: "Ellipse", value: SHAPE.ELLIPSE }
    ],
    default: SHAPE.ELLIPSE,
    desc: "Vignette shape — ellipse matches the image aspect ratio"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
  softness: optionTypes.softness.default,
  shape: optionTypes.shape.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const VIG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strength;
uniform float u_radius;
uniform float u_softness;
uniform int   u_shape;        // 0 CIRCLE, 1 ELLIPSE
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 c = texture(u_source, suv);

  float dx = (x / u_res.x - 0.5) * 2.0;
  float dy = (y / u_res.y - 0.5) * 2.0;
  if (u_shape == 1) {
    float aspect = u_res.x / u_res.y;
    if (aspect > 1.0) dx /= aspect;
    else dy *= aspect;
  }
  float dist = sqrt(dx * dx + dy * dy);
  float vign = smoothstep(u_radius - u_softness, u_radius + u_softness, dist);
  float factor = 1.0 - vign * u_strength;

  vec3 rgb = clamp(c.rgb * factor, 0.0, 1.0);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, c.a);
}
`;

type Cache = { vig: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    vig: linkProgram(gl, VIG_FS, [
      "u_source", "u_res", "u_strength", "u_radius",
      "u_softness", "u_shape", "u_levels",
    ] as const),
  };
  return _cache;
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const vignetteFilter = (input: any, options = defaults) => {
  const { strength, radius, softness, shape, palette } = options;
  const W = input.width, H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "vignette:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.vig, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.vig.uniforms.u_source, 0);
        gl.uniform2f(cache.vig.uniforms.u_res, W, H);
        gl.uniform1f(cache.vig.uniforms.u_strength, strength);
        gl.uniform1f(cache.vig.uniforms.u_radius, radius);
        gl.uniform1f(cache.vig.uniforms.u_softness, softness);
        gl.uniform1i(cache.vig.uniforms.u_shape, shape === SHAPE.ELLIPSE ? 1 : 0);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.vig.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Vignette", "WebGL2",
            `${shape} s=${strength}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Vignette", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      let dx = (x / W - 0.5) * 2;
      let dy = (y / H - 0.5) * 2;

      if (shape === SHAPE.ELLIPSE) {
        const aspect = W / H;
        if (aspect > 1) dx /= aspect;
        else dy *= aspect;
      }

      const dist = Math.sqrt(dx * dx + dy * dy);
      const vign = smoothstep(radius - softness, radius + softness, dist);
      const factor = 1 - vign * strength;

      const r = Math.max(0, Math.min(255, Math.round(buf[i] * factor)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] * factor)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] * factor)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Vignette",
  func: vignetteFilter,
  optionTypes,
  options: defaults,
  defaults
});
