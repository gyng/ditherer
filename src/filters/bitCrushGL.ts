import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-channel bit-depth reduction. levels = 2^bits; quantise to
// nearest band on each channel.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_step;

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 rgb = c.rgb * 255.0;
  rgb = floor(floor(rgb / u_step + 0.5) * u_step + 0.5);
  fragColor = vec4(clamp(rgb, 0.0, 255.0) / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_step"] as const) };
  return _cache;
};

export const bitCrushGLAvailable = (): boolean => glAvailable();

export const renderBitCrushGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  bits: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "bitCrush:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const levels = 2 ** bits;
  const step = 255 / (levels - 1);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_step, step);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
