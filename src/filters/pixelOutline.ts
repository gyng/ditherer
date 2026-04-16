import { RANGE, COLOR } from "constants/controlTypes";
import {
  cloneCanvas,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
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

export const optionTypes = {
  outlineColor: { type: COLOR, default: [0, 0, 0], desc: "Border color painted around sharp color changes" },
  outlineWidth: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1, desc: "Thickness of the sprite-like outline" },
  mergeThreshold: { type: RANGE, range: [0, 128], step: 1, default: 24, desc: "Neighbor color difference required before drawing an outline" }
};

export const defaults = {
  outlineColor: optionTypes.outlineColor.default,
  outlineWidth: optionTypes.outlineWidth.default,
  mergeThreshold: optionTypes.mergeThreshold.default
};

const colorDelta = (buf: Uint8ClampedArray, a: number, b: number) => (
  (Math.abs(buf[a] - buf[b]) + Math.abs(buf[a + 1] - buf[b + 1]) + Math.abs(buf[a + 2] - buf[b + 2])) / 3
);

const PX_OUTLINE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;    // 0..128 (operates in 0..255 space)
uniform int   u_radius;       // dilation radius in pixels (ceil of outlineWidth - 1)
uniform float u_reach;        // radius + 0.35 (matches CPU reach)
uniform float u_edgeAlpha;
uniform vec3  u_outlineColor;

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

float mad(vec3 a, vec3 b) {
  vec3 d = abs(a - b) * 255.0;
  return (d.r + d.g + d.b) / 3.0;
}

// Is pixel (x, y) a 4-neighbour edge? (Matches the CPU edge detector.)
bool isEdge(float x, float y) {
  vec3 c = samplePx(x, y);
  return mad(c, samplePx(x - 1.0, y)) > u_threshold
      || mad(c, samplePx(x + 1.0, y)) > u_threshold
      || mad(c, samplePx(x, y - 1.0)) > u_threshold
      || mad(c, samplePx(x, y + 1.0)) > u_threshold;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 self = texture(u_source, suv);

  bool edge = false;
  if (u_radius <= 0) {
    edge = isEdge(x, y);
  } else {
    // Dilation: any edge within a circular radius paints us.
    for (int ky = -8; ky <= 8; ky++) {
      if (ky < -u_radius || ky > u_radius) continue;
      for (int kx = -8; kx <= 8; kx++) {
        if (kx < -u_radius || kx > u_radius) continue;
        if (sqrt(float(kx * kx + ky * ky)) > u_reach) continue;
        float nx = x + float(kx);
        float ny = y + float(ky);
        if (nx < 0.0 || nx >= u_res.x || ny < 0.0 || ny >= u_res.y) continue;
        if (isEdge(nx, ny)) { edge = true; break; }
      }
      if (edge) break;
    }
  }

  vec3 rgb = self.rgb;
  if (edge) rgb = mix(rgb, u_outlineColor, u_edgeAlpha);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { po: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    po: linkProgram(gl, PX_OUTLINE_FS, [
      "u_source", "u_res", "u_threshold", "u_radius", "u_reach",
      "u_edgeAlpha", "u_outlineColor",
    ] as const),
  };
  return _cache;
};

const pixelOutline = (input: any, options = defaults) => {
  const { outlineColor, outlineWidth, mergeThreshold } = options;
  const W = input.width;
  const H = input.height;
  const edgeAlpha = Math.min(1, Math.max(0.1, outlineWidth));
  const radius = Math.max(0, outlineWidth - 1);
  const ceilRadius = Math.ceil(radius);
  const reach = radius + 0.35;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "pixelOutline:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.po, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.po.uniforms.u_source, 0);
        gl.uniform2f(cache.po.uniforms.u_res, W, H);
        gl.uniform1f(cache.po.uniforms.u_threshold, mergeThreshold);
        gl.uniform1i(cache.po.uniforms.u_radius, Math.min(8, ceilRadius));
        gl.uniform1f(cache.po.uniforms.u_reach, reach);
        gl.uniform1f(cache.po.uniforms.u_edgeAlpha, edgeAlpha);
        gl.uniform3f(cache.po.uniforms.u_outlineColor, outlineColor[0] / 255, outlineColor[1] / 255, outlineColor[2] / 255);
      }, vao);

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
      if (!edge && x < W - 1 && colorDelta(buf, i, getBufferIndex(x + 1, y, W)) > mergeThreshold) edge = true;
      if (!edge && y > 0 && colorDelta(buf, i, getBufferIndex(x, y - 1, W)) > mergeThreshold) edge = true;
      if (!edge && y < H - 1 && colorDelta(buf, i, getBufferIndex(x, y + 1, W)) > mergeThreshold) edge = true;

      edgeMap[y * W + x] = edge ? 1 : 0;
    }
  }

  if (outlineWidth > 1) {
    const dilated = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let edge = 0;
        for (let ky = -ceilRadius; ky <= ceilRadius && !edge; ky++) {
          for (let kx = -ceilRadius; kx <= ceilRadius && !edge; kx++) {
            if (Math.hypot(kx, ky) > reach) continue;
            const nx = x + kx;
            const ny = y + ky;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            edge = edgeMap[ny * W + nx];
          }
        }
        dilated[y * W + x] = edge;
      }
    }
    edgeMap.set(dilated);
  }

  const outBuf = new Uint8ClampedArray(buf);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!edgeMap[y * W + x]) continue;
      const i = getBufferIndex(x, y, W);
      outBuf[i] = Math.round(buf[i] + (outlineColor[0] - buf[i]) * edgeAlpha);
      outBuf[i + 1] = Math.round(buf[i + 1] + (outlineColor[1] - buf[i + 1]) * edgeAlpha);
      outBuf[i + 2] = Math.round(buf[i + 2] + (outlineColor[2] - buf[i + 2]) * edgeAlpha);
      outBuf[i + 3] = 255;
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
  defaults
});
