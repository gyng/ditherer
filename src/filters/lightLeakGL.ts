import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Corner light-leak overlay: quadratic falloff from a picked corner with
// channel-weighted tint (full red, 0.7 green, 0.4 blue) to match the JS
// reference's warm-leaning bias.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_corner;     // pixel coords of leak source (JS-y)
uniform vec3  u_color;      // 0..255
uniform float u_intensity;
uniform float u_maxDist;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 c = texture(u_source, v_uv);
  vec3 src = c.rgb * 255.0;

  vec2 d = vec2(jsX - u_corner.x, jsY - u_corner.y);
  float dist = length(d);
  float t = max(0.0, 1.0 - dist / u_maxDist);
  float leak = t * t * u_intensity;

  vec3 r = vec3(
    min(255.0, src.r + u_color.r * leak),
    min(255.0, src.g + u_color.g * leak * 0.7),
    min(255.0, src.b + u_color.b * leak * 0.4)
  );
  fragColor = vec4(floor(r + 0.5) / 255.0, c.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_corner", "u_color", "u_intensity", "u_maxDist",
  ] as const) };
  return _cache;
};

export const lightLeakGLAvailable = (): boolean => glAvailable();

export const renderLightLeakGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  cornerX: number, cornerY: number,
  color: [number, number, number],
  intensity: number, maxDist: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lightLeak:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_corner, cornerX, cornerY);
    gl.uniform3f(cache.prog.uniforms.u_color, color[0], color[1], color[2]);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
    gl.uniform1f(cache.prog.uniforms.u_maxDist, maxDist);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
