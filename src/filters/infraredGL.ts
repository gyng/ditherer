import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// IR film simulation — the "Wood effect":
// green (foliage) goes bright, blue (sky) goes dark, red stays neutral.
// Optional false-colour pass shifts to the pink/magenta look typical of
// Kodak Aerochrome.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_intensity;
uniform float u_falseColor;
void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;
  float irLum = clamp(src.r * 0.3 + src.g * 0.7 + src.b * (-0.2), 0.0, 255.0);
  vec3 ir;
  if (u_falseColor > 0.0) {
    ir = vec3(
      irLum * 0.9 + src.g * 0.3 * u_falseColor,
      irLum * 0.3 - src.b * 0.2 * u_falseColor,
      irLum * 0.5 + src.r * 0.2 * u_falseColor
    );
  } else {
    ir = vec3(irLum);
  }
  vec3 blended = clamp(src * (1.0 - u_intensity) + ir * u_intensity, 0.0, 255.0);
  fragColor = vec4(floor(blended + 0.5) / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_intensity", "u_falseColor"] as const) };
  return _cache;
};

export const infraredGLAvailable = (): boolean => glAvailable();

export const renderInfraredGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  intensity: number,
  falseColor: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "infrared:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
    gl.uniform1f(cache.prog.uniforms.u_falseColor, falseColor);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
