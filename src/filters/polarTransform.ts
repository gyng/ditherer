import { RANGE, ENUM } from "constants/controlTypes";
import {
  cloneCanvas,
  sampleBilinear,
  sampleNearest,
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

const MODE = {
  RECT_TO_POLAR: "RECT_TO_POLAR",
  POLAR_TO_RECT: "POLAR_TO_RECT"
};

const INTERPOLATION = {
  NEAREST: "NEAREST",
  BILINEAR: "BILINEAR"
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Rect -> Polar", value: MODE.RECT_TO_POLAR },
      { name: "Polar -> Rect", value: MODE.POLAR_TO_RECT }
    ],
    default: MODE.RECT_TO_POLAR,
    desc: "Wrap the image around a circle or unwrap a circular image into a strip"
  },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of the transform" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of the transform" },
  angle: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Rotation offset in degrees" },
  interpolation: {
    type: ENUM,
    options: [
      { name: "Nearest", value: INTERPOLATION.NEAREST },
      { name: "Bilinear", value: INTERPOLATION.BILINEAR }
    ],
    default: INTERPOLATION.BILINEAR,
    desc: "Sampling method for remapped pixels"
  }
};

export const defaults = {
  mode: optionTypes.mode.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  angle: optionTypes.angle.default,
  interpolation: optionTypes.interpolation.default
};

const POLAR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;         // 0 RECT_TO_POLAR, 1 POLAR_TO_RECT
uniform vec2  u_center;       // centre pixel coords
uniform float u_angleOffset;  // radians
uniform float u_maxRadius;
uniform int   u_nearest;

// Nearest sampler mirroring JS sampleNearest: round-half-to-even truncation,
// clamped.
vec4 samplePx(float sx, float sy) {
  if (u_nearest == 1) {
    float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
    float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
    return texelFetch(u_source, ivec2(int(cx), int(cy)), 0);
  }
  // Bilinear via texture() with GL_LINEAR — matches utils.sampleBilinear
  // semantics to within sub-pixel rounding.
  vec2 uv = vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y);
  return texture(u_source, clamp(uv, vec2(0.0), vec2(1.0)));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float sx = 0.0, sy = 0.0;
  bool visible = true;

  if (u_mode == 0) {
    float dx = x - u_center.x;
    float dy = y - u_center.y;
    float radius = sqrt(dx * dx + dy * dy);
    if (radius > u_maxRadius) {
      visible = false;
    } else {
      float theta = atan(dy, dx) - u_angleOffset;
      if (theta < 0.0) theta += 6.28318530718;
      sx = theta / 6.28318530718 * (u_res.x - 1.0);
      sy = radius / u_maxRadius * (u_res.y - 1.0);
    }
  } else {
    float theta = (x / max(1.0, u_res.x - 1.0)) * 6.28318530718 + u_angleOffset;
    float radius = y / max(1.0, u_res.y - 1.0) * u_maxRadius;
    sx = u_center.x + cos(theta) * radius;
    sy = u_center.y + sin(theta) * radius;
  }

  if (!visible) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  fragColor = samplePx(sx, sy);
}
`;

type Cache = { polar: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    polar: linkProgram(gl, POLAR_FS, [
      "u_source", "u_res", "u_mode", "u_center",
      "u_angleOffset", "u_maxRadius", "u_nearest",
    ] as const),
  };
  return _cache;
};

const polarTransform = (input: any, options = defaults) => {
  const { mode, centerX, centerY, angle, interpolation } = options;
  const W = input.width;
  const H = input.height;
  const cx = W * centerX;
  const cy = H * centerY;
  const maxRadius = Math.max(1, Math.min(W, H) * 0.5);
  const angleOffset = angle * Math.PI / 180;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "polarTransform:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      // Shared pool creates textures with NEAREST filtering; bilinear mode
      // in the shader uses `texture()` so we need GL_LINEAR set here. Reset
      // after the draw so other filters' expectations aren't perturbed.
      const wantLinear = interpolation === INTERPOLATION.BILINEAR;
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, wantLinear ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, wantLinear ? gl.LINEAR : gl.NEAREST);

      drawPass(gl, null, W, H, cache.polar, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.polar.uniforms.u_source, 0);
        gl.uniform2f(cache.polar.uniforms.u_res, W, H);
        gl.uniform1i(cache.polar.uniforms.u_mode, mode === MODE.POLAR_TO_RECT ? 1 : 0);
        gl.uniform2f(cache.polar.uniforms.u_center, cx, cy);
        gl.uniform1f(cache.polar.uniforms.u_angleOffset, angleOffset);
        gl.uniform1f(cache.polar.uniforms.u_maxRadius, maxRadius);
        gl.uniform1i(cache.polar.uniforms.u_nearest, interpolation === INTERPOLATION.NEAREST ? 1 : 0);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (rendered) {
        logFilterBackend("Polar Transform", "WebGL2", `${mode} ${interpolation}`);
        return rendered;
      }
    }
  }

  logFilterWasmStatus("Polar Transform", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const src = inputCtx.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(src.length);
  const sample = interpolation === INTERPOLATION.NEAREST ? sampleNearest : sampleBilinear;
  const rgba = [0, 0, 0, 255];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx = 0;
      let sy = 0;
      let visible = true;

      if (mode === MODE.RECT_TO_POLAR) {
        const dx = x - cx;
        const dy = y - cy;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius > maxRadius) {
          visible = false;
        } else {
          let theta = Math.atan2(dy, dx) - angleOffset;
          if (theta < 0) theta += Math.PI * 2;
          sx = theta / (Math.PI * 2) * (W - 1);
          sy = radius / maxRadius * (H - 1);
        }
      } else {
        const theta = (x / Math.max(1, W - 1)) * Math.PI * 2 + angleOffset;
        const radius = y / Math.max(1, H - 1) * maxRadius;
        sx = cx + Math.cos(theta) * radius;
        sy = cy + Math.sin(theta) * radius;
      }

      const i = (y * W + x) * 4;
      if (!visible) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 255;
        continue;
      }

      sample(src, W, H, sx, sy, rgba);
      out[i] = rgba[0];
      out[i + 1] = rgba[1];
      out[i + 2] = rgba[2];
      out[i + 3] = rgba[3];
    }
  }

  outputCtx.putImageData(new ImageData(out, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Polar Transform",
  func: polarTransform,
  optionTypes,
  options: defaults,
  defaults
});
