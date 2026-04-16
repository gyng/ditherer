import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Coordinate mirror — horizontal, vertical, or both.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_flipX;
uniform int   u_flipY;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float sx = u_flipX == 1 ? u_res.x - 1.0 - jsX : jsX;
  float sy = u_flipY == 1 ? u_res.y - 1.0 - jsY : jsY;
  fragColor = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y));
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_res", "u_flipX", "u_flipY"] as const) };
  return _cache;
};

export const flipGLAvailable = (): boolean => glAvailable();

export const renderFlipGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  flipX: boolean, flipY: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "flip:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_flipX, flipX ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_flipY, flipY ? 1 : 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
