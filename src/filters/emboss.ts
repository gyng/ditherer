import { RANGE, PALETTE } from "constants/controlTypes";
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
  angle: { type: RANGE, range: [0, 360], step: 15, default: 135, desc: "Light direction angle for the emboss relief effect" },
  strength: { type: RANGE, range: [0, 3], step: 0.1, default: 1, desc: "Emboss depth — higher values exaggerate the relief" },
  blend: { type: RANGE, range: [0, 1], step: 0.05, default: 0, desc: "Blend between embossed result (0) and original image (1)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  angle: optionTypes.angle.default,
  strength: optionTypes.strength.default,
  blend: optionTypes.blend.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const EMBOSS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_kernel[9];
uniform float u_blend;
uniform float u_levels;

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 acc = vec3(0.0);
  for (int ky = -1; ky <= 1; ky++) {
    for (int kx = -1; kx <= 1; kx++) {
      float w = u_kernel[(ky + 1) * 3 + (kx + 1)];
      acc += samplePx(x + float(kx), y + float(ky)) * 255.0 * w;
    }
  }
  acc += vec3(128.0);

  vec3 self = samplePx(x, y) * 255.0;
  vec3 mixed = acc * (1.0 - u_blend) + self * u_blend;
  vec3 rgb = clamp(mixed, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float a = texture(u_source, suv).a;
  fragColor = vec4(rgb, a);
}
`;

type Cache = { em: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    em: linkProgram(gl, EMBOSS_FS, [
      "u_source", "u_res", "u_kernel", "u_blend", "u_levels",
    ] as const),
  };
  return _cache;
};

const embossFilter = (input: any, options = defaults) => {
  const { angle, strength, blend, palette } = options;
  const W = input.width, H = input.height;

  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);
  const kernel = new Float32Array(9);
  for (let ky = -1; ky <= 1; ky++) {
    for (let kx = -1; kx <= 1; kx++) {
      const proj = kx * dx + ky * dy;
      kernel[(ky + 1) * 3 + (kx + 1)] = proj * strength;
    }
  }
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += kernel[i];
  kernel[4] -= sum;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "emboss:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.em, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.em.uniforms.u_source, 0);
        gl.uniform2f(cache.em.uniforms.u_res, W, H);
        gl.uniform1fv(cache.em.uniforms.u_kernel, kernel);
        gl.uniform1f(cache.em.uniforms.u_blend, blend);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.em.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Emboss", "WebGL2",
            `angle=${angle}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Emboss", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let er = 0, eg = 0, eb = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          const si = getBufferIndex(nx, ny, W);
          const w = kernel[(ky + 1) * 3 + (kx + 1)];
          er += buf[si] * w;
          eg += buf[si + 1] * w;
          eb += buf[si + 2] * w;
        }
      }

      er = er + 128;
      eg = eg + 128;
      eb = eb + 128;

      const i = getBufferIndex(x, y, W);
      const r = Math.max(0, Math.min(255, Math.round(er * (1 - blend) + buf[i] * blend)));
      const g = Math.max(0, Math.min(255, Math.round(eg * (1 - blend) + buf[i + 1] * blend)));
      const b = Math.max(0, Math.min(255, Math.round(eb * (1 - blend) + buf[i + 2] * blend)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Emboss",
  func: embossFilter,
  optionTypes,
  options: defaults,
  defaults
});
