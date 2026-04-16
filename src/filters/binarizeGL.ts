import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-channel threshold → 0 or 1. Alpha is not sRGB-encoded, so when
// u_linearize=1 only RGB get transformed into linear before comparison.
// Matches the JS path: `val > threshold` in the chosen colour space.
const BINARIZE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec4  u_threshold;  // R, G, B, A thresholds in 0..1
uniform int   u_linearize;  // 1 = linearize RGB before threshold

float srgbToLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  if (u_linearize == 1) {
    c.r = srgbToLinear(c.r);
    c.g = srgbToLinear(c.g);
    c.b = srgbToLinear(c.b);
  }
  fragColor = vec4(
    c.r > u_threshold.r ? 1.0 : 0.0,
    c.g > u_threshold.g ? 1.0 : 0.0,
    c.b > u_threshold.b ? 1.0 : 0.0,
    c.a > u_threshold.a ? 1.0 : 0.0
  );
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, BINARIZE_FS, ["u_source", "u_threshold", "u_linearize"] as const),
  };
  return _cache;
};

export const binarizeGLAvailable = (): boolean => glAvailable();

export const renderBinarizeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  thresholdR: number, thresholdG: number, thresholdB: number, thresholdA: number,
  linearize: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "binarize:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform4f(
      cache.prog.uniforms.u_threshold,
      thresholdR / 255, thresholdG / 255, thresholdB / 255, thresholdA / 255,
    );
    gl.uniform1i(cache.prog.uniforms.u_linearize, linearize ? 1 : 0);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
