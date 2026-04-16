import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// JS semantics: `byte > int_threshold`. Float samples of byte values can
// bobble at exact equality, so we bias the threshold by +0.5/255 — that
// drops equality cases cleanly on the "not greater" side.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_threshold; // byte / 255 + 0.5 / 255
void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(
    c.r > u_threshold ? 1.0 - c.r : c.r,
    c.g > u_threshold ? 1.0 - c.g : c.g,
    c.b > u_threshold ? 1.0 - c.b : c.b,
    c.a
  );
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_threshold"] as const) };
  return _cache;
};

export const solarizeGLAvailable = (): boolean => glAvailable();

export const renderSolarizeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  threshold: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "solarize:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_threshold, (threshold + 0.5) / 255);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
