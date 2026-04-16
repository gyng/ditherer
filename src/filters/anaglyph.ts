import { RANGE, ENUM } from "constants/controlTypes";
import {
  cloneCanvas,
  clamp,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";
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

const MODE = {
  RED_CYAN: "RED_CYAN",
  RED_GREEN: "RED_GREEN",
  MAGENTA_GREEN: "MAGENTA_GREEN",
  YELLOW_BLUE: "YELLOW_BLUE"
};

const DEPTH = {
  LUMINANCE: "LUMINANCE",
  EDGE: "EDGE",
  CONSTANT: "CONSTANT"
};

export const optionTypes = {
  strength: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "Horizontal channel offset in pixels" },
  mode: {
    type: ENUM,
    options: [
      { name: "Red / Cyan", value: MODE.RED_CYAN },
      { name: "Red / Green", value: MODE.RED_GREEN },
      { name: "Magenta / Green", value: MODE.MAGENTA_GREEN },
      { name: "Yellow / Blue", value: MODE.YELLOW_BLUE }
    ],
    default: MODE.RED_CYAN,
    desc: "Color pair used for the stereoscopic split"
  },
  depthSource: {
    type: ENUM,
    options: [
      { name: "Luminance", value: DEPTH.LUMINANCE },
      { name: "Edge density", value: DEPTH.EDGE },
      { name: "Constant", value: DEPTH.CONSTANT }
    ],
    default: DEPTH.LUMINANCE,
    desc: "How the offset strength is modulated across the image"
  }
};

export const defaults = {
  strength: optionTypes.strength.default,
  mode: optionTypes.mode.default,
  depthSource: optionTypes.depthSource.default
};

const MODE_ID: Record<string, number> = { RED_CYAN: 0, RED_GREEN: 1, MAGENTA_GREEN: 2, YELLOW_BLUE: 3 };
const DEPTH_ID: Record<string, number> = { LUMINANCE: 0, EDGE: 1, CONSTANT: 2 };

const ANA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strength;
uniform int   u_mode;       // 0 RED_CYAN .. 3 YELLOW_BLUE
uniform int   u_depthSource; // 0 LUMINANCE, 1 EDGE, 2 CONSTANT

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

// Sobel magnitude on the luminance channel.
float sobelLum(float x, float y) {
  float a = lum(samplePx(x - 1.0, y - 1.0));
  float b = lum(samplePx(x,       y - 1.0));
  float c = lum(samplePx(x + 1.0, y - 1.0));
  float d = lum(samplePx(x - 1.0, y      ));
  float f = lum(samplePx(x + 1.0, y      ));
  float g = lum(samplePx(x - 1.0, y + 1.0));
  float h = lum(samplePx(x,       y + 1.0));
  float i = lum(samplePx(x + 1.0, y + 1.0));
  float gx = (c + 2.0 * f + i) - (a + 2.0 * d + g);
  float gy = (g + 2.0 * h + i) - (a + 2.0 * b + c);
  return clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float depth;
  if (u_depthSource == 2) depth = 1.0;
  else if (u_depthSource == 1) depth = sobelLum(x, y);
  else depth = lum(samplePx(x, y));

  float offset = max(1.0, floor(u_strength * depth + 0.5));
  float lx = clamp(x - offset, 0.0, u_res.x - 1.0);
  float rx = clamp(x + offset, 0.0, u_res.x - 1.0);
  vec3 L = samplePx(lx, y);
  vec3 R = samplePx(rx, y);

  vec3 rgb;
  if (u_mode == 0) rgb = vec3(L.r, R.g, R.b);
  else if (u_mode == 1) rgb = vec3(L.r, R.g, 0.0);
  else if (u_mode == 2) rgb = vec3(L.r, R.g, L.b);
  else rgb = vec3(L.r, L.g, R.b);

  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float a = texture(u_source, suv).a;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

type Cache = { ana: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ana: linkProgram(gl, ANA_FS, [
      "u_source", "u_res", "u_strength", "u_mode", "u_depthSource",
    ] as const),
  };
  return _cache;
};

const anaglyph = (input: any, options = defaults) => {
  const { strength, mode, depthSource } = options;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "anaglyph:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ana, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ana.uniforms.u_source, 0);
        gl.uniform2f(cache.ana.uniforms.u_res, W, H);
        gl.uniform1f(cache.ana.uniforms.u_strength, strength);
        gl.uniform1i(cache.ana.uniforms.u_mode, MODE_ID[mode] ?? 0);
        gl.uniform1i(cache.ana.uniforms.u_depthSource, DEPTH_ID[depthSource] ?? 0);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        logFilterBackend("Anaglyph", "WebGL2", `${mode} ${depthSource}`);
        return rendered;
      }
    }
  }

  logFilterWasmStatus("Anaglyph", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = depthSource === DEPTH.LUMINANCE || depthSource === DEPTH.EDGE ? computeLuminance(buf, W, H) : null;
  const edge = depthSource === DEPTH.EDGE && lum ? sobelEdges(lum, W, H).magnitude : null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const depth = depthSource === DEPTH.CONSTANT
        ? 1
        : depthSource === DEPTH.EDGE
          ? Math.min(1, (edge![y * W + x] || 0) / 255)
          : (lum![y * W + x] || 0);

      const offset = Math.max(1, Math.round(strength * depth));
      const lx = clamp(0, W - 1, x - offset);
      const rx = clamp(0, W - 1, x + offset);
      const li = getBufferIndex(lx, y, W);
      const ri = getBufferIndex(rx, y, W);

      let r: number;
      let g: number;
      let b: number;

      if (mode === MODE.RED_CYAN) {
        r = buf[li];
        g = buf[ri + 1];
        b = buf[ri + 2];
      } else if (mode === MODE.RED_GREEN) {
        r = buf[li];
        g = buf[ri + 1];
        b = 0;
      } else if (mode === MODE.MAGENTA_GREEN) {
        r = buf[li];
        g = buf[ri + 1];
        b = buf[li + 2];
      } else {
        r = buf[li];
        g = buf[li + 1];
        b = buf[ri + 2];
      }

      outBuf[i] = r;
      outBuf[i + 1] = g;
      outBuf[i + 2] = b;
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anaglyph",
  func: anaglyph,
  optionTypes,
  options: defaults,
  defaults
});
