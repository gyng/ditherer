import { RANGE, COLOR } from "../constants/controlTypes";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { defineFilter } from "./types";
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

export const optionTypes = {
  outlineColor: {
    type: COLOR,
    default: [0, 0, 0],
    desc: "Border color painted around sharp color changes",
  },
  outlineWidth: {
    type: RANGE,
    range: [0.1, 4],
    step: 0.1,
    default: 1,
    desc: "Thickness of the sprite-like outline",
  },
  mergeThreshold: {
    type: RANGE,
    range: [0, 128],
    step: 1,
    default: 24,
    desc: "Neighbor color difference required before drawing an outline",
  },
};

export const defaults = {
  outlineColor: optionTypes.outlineColor.default,
  outlineWidth: optionTypes.outlineWidth.default,
  mergeThreshold: optionTypes.mergeThreshold.default,
};

const colorDelta = (buf: Uint8ClampedArray, a: number, b: number) => {
  const alphaA = buf[a + 3] / 255;
  const alphaB = buf[b + 3] / 255;
  const rgb =
    (Math.abs(buf[a] * alphaA - buf[b] * alphaB) +
      Math.abs(buf[a + 1] * alphaA - buf[b + 1] * alphaB) +
      Math.abs(buf[a + 2] * alphaA - buf[b + 2] * alphaB)) /
    3;
  return Math.max(rgb, Math.abs(buf[a + 3] - buf[b + 3]));
};

const PX_OUTLINE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;    // 0..128 (operates in 0..255 space)
uniform float u_width;
uniform vec3  u_outlineColor;

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv);
}

float rgbaDelta(vec4 a, vec4 b) {
  vec3 d = abs(a.rgb * a.a - b.rgb * b.a) * 255.0;
  return max((d.r + d.g + d.b) / 3.0, abs(a.a - b.a) * 255.0);
}

// Is pixel (x, y) a 4-neighbour edge? (Matches the CPU edge detector.)
bool isEdge(float x, float y) {
  vec4 c = samplePx(x, y);
  return rgbaDelta(c, samplePx(x - 1.0, y)) > u_threshold
      || rgbaDelta(c, samplePx(x + 1.0, y)) > u_threshold
      || rgbaDelta(c, samplePx(x, y - 1.0)) > u_threshold
      || rgbaDelta(c, samplePx(x, y + 1.0)) > u_threshold;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 self = texture(u_source, suv);

  float nearest = 1e6;
  for (int ky = -4; ky <= 4; ky++) {
    for (int kx = -4; kx <= 4; kx++) {
        float distance = length(vec2(float(kx), float(ky)));
        if (distance >= u_width) continue;
        float nx = x + float(kx);
        float ny = y + float(ky);
        if (nx < 0.0 || nx >= u_res.x || ny < 0.0 || ny >= u_res.y) continue;
        if (isEdge(nx, ny)) nearest = min(nearest, distance);
    }
  }
  float coverage = clamp(u_width - nearest, 0.0, 1.0);
  vec3 rgb = mix(self.rgb, u_outlineColor, coverage);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), self.a);
}
`;

type Cache = { po: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    po: linkProgram(gl, PX_OUTLINE_FS, [
      "u_source",
      "u_res",
      "u_threshold",
      "u_width",
      "u_outlineColor",
    ] as const),
  };
  return _cache;
};

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const validColor = (value: unknown, fallback: number[]): number[] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.slice(0, 3).every((channel) => Number.isFinite(Number(channel)))
    ? value.slice(0, 3).map((channel) => Math.max(0, Math.min(255, Number(channel))))
    : fallback;

const pixelOutline = (
  input: any,
  options: Partial<typeof defaults> & { _webglAcceleration?: boolean } = defaults,
) => {
  const outlineColor = validColor(options.outlineColor, defaults.outlineColor);
  const outlineWidth = finite(options.outlineWidth, defaults.outlineWidth, 0.1, 4);
  const mergeThreshold = finite(options.mergeThreshold, defaults.mergeThreshold, 0, 128);
  const W = input.width;
  const H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "pixelOutline:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(
        gl,
        null,
        W,
        H,
        cache.po,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.po.uniforms.u_source, 0);
          gl.uniform2f(cache.po.uniforms.u_res, W, H);
          gl.uniform1f(cache.po.uniforms.u_threshold, mergeThreshold);
          gl.uniform1f(cache.po.uniforms.u_width, outlineWidth);
          gl.uniform3f(
            cache.po.uniforms.u_outlineColor,
            outlineColor[0] / 255,
            outlineColor[1] / 255,
            outlineColor[2] / 255,
          );
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        logFilterBackend("Pixel Outline", "WebGL2", `w=${outlineWidth} thresh=${mergeThreshold}`);
        return rendered;
      }
    }
  }

  logFilterWasmStatus("Pixel Outline", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const edgeMap = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let edge = false;

      if (x > 0 && colorDelta(buf, i, getBufferIndex(x - 1, y, W)) > mergeThreshold) edge = true;
      if (!edge && x < W - 1 && colorDelta(buf, i, getBufferIndex(x + 1, y, W)) > mergeThreshold)
        edge = true;
      if (!edge && y > 0 && colorDelta(buf, i, getBufferIndex(x, y - 1, W)) > mergeThreshold)
        edge = true;
      if (!edge && y < H - 1 && colorDelta(buf, i, getBufferIndex(x, y + 1, W)) > mergeThreshold)
        edge = true;

      edgeMap[y * W + x] = edge ? 1 : 0;
    }
  }

  const outBuf = new Uint8ClampedArray(buf);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let ky = -4; ky <= 4; ky++) {
        for (let kx = -4; kx <= 4; kx++) {
          const distance = Math.hypot(kx, ky);
          if (distance >= outlineWidth) continue;
          const nx = x + kx;
          const ny = y + ky;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (edgeMap[ny * W + nx]) nearest = Math.min(nearest, distance);
        }
      }
      const coverage = Math.max(0, Math.min(1, outlineWidth - nearest));
      if (coverage <= 0) continue;
      const i = getBufferIndex(x, y, W);
      outBuf[i] = Math.round(buf[i] + (outlineColor[0] - buf[i]) * coverage);
      outBuf[i + 1] = Math.round(buf[i + 1] + (outlineColor[1] - buf[i + 1]) * coverage);
      outBuf[i + 2] = Math.round(buf[i + 2] + (outlineColor[2] - buf[i + 2]) * coverage);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Pixel Outline",
  func: pixelOutline,
  optionTypes,
  options: defaults,
  defaults,
});
