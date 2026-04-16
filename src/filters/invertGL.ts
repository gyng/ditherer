import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-channel inversion. Each channel's invert flag lives in a bvec4
// so the shader can xor cheaply.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform bvec4 u_invert;

void main() {
  vec4 c = texture(u_source, v_uv);
  vec4 inv = vec4(1.0) - c;
  fragColor = vec4(
    u_invert.r ? inv.r : c.r,
    u_invert.g ? inv.g : c.g,
    u_invert.b ? inv.b : c.b,
    u_invert.a ? inv.a : c.a
  );
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_invert"] as const) };
  return _cache;
};

export const invertGLAvailable = (): boolean => glAvailable();

export const renderInvertGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  invertR: boolean, invertG: boolean, invertB: boolean, invertA: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "invert:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform4i(cache.prog.uniforms.u_invert,
      invertR ? 1 : 0, invertG ? 1 : 0, invertB ? 1 : 0, invertA ? 1 : 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
