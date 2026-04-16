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
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform float u_mix;
void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;
  float lum = (0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b) / 255.0;
  vec3 mapped;
  if (lum < 0.5) {
    mapped = mix(u_color1, u_color2, lum * 2.0);
  } else {
    mapped = mix(u_color2, u_color3, (lum - 0.5) * 2.0);
  }
  vec3 fin = floor(mix(src, mapped, u_mix) + 0.5);
  fragColor = vec4(fin / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_color1", "u_color2", "u_color3", "u_mix",
  ] as const) };
  return _cache;
};

export const gradientMapGLAvailable = (): boolean => glAvailable();

export const renderGradientMapGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  color1: [number, number, number],
  color2: [number, number, number],
  color3: [number, number, number],
  mixAmount: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "gradientMap:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform3f(cache.prog.uniforms.u_color1, color1[0], color1[1], color1[2]);
    gl.uniform3f(cache.prog.uniforms.u_color2, color2[0], color2[1], color2[2]);
    gl.uniform3f(cache.prog.uniforms.u_color3, color3[0], color3[1], color3[2]);
    gl.uniform1f(cache.prog.uniforms.u_mix, mixAmount);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
