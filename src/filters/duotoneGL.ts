import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec3 u_shadow;
uniform vec3 u_highlight;
void main() {
  vec4 c = texture(u_source, v_uv);
  float t = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  fragColor = vec4(mix(u_shadow, u_highlight, t), c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_shadow", "u_highlight"] as const) };
  return _cache;
};

export const duotoneGLAvailable = (): boolean => glAvailable();

export const renderDuotoneGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  shadow: [number, number, number],
  highlight: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "duotone:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform3f(cache.prog.uniforms.u_shadow, shadow[0] / 255, shadow[1] / 255, shadow[2] / 255);
    gl.uniform3f(cache.prog.uniforms.u_highlight, highlight[0] / 255, highlight[1] / 255, highlight[2] / 255);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
