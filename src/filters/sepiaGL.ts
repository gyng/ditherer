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
uniform float u_intensity;
void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;
  vec3 sep = vec3(
    min(255.0, 0.393 * src.r + 0.769 * src.g + 0.189 * src.b),
    min(255.0, 0.349 * src.r + 0.686 * src.g + 0.168 * src.b),
    min(255.0, 0.272 * src.r + 0.534 * src.g + 0.131 * src.b)
  );
  vec3 mixed = src + (sep - src) * u_intensity;
  fragColor = vec4(floor(mixed + 0.5) / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_intensity"] as const) };
  return _cache;
};

export const sepiaGLAvailable = (): boolean => glAvailable();

export const renderSepiaGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  intensity: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "sepia:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
