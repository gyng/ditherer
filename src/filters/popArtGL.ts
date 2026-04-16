import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Lichtenstein-style pop-art pass: saturation boost + colour posterise +
// luminance-driven Ben-Day dots on a white background. JS-orientation
// pixel coordinates match the reference loop so dot placement is stable.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dotSize;
uniform float u_levels;
uniform float u_satBoost;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb * 255.0;

  // Saturation boost around luma.
  float gray = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  vec3 sat = clamp(gray + (src - gray) * u_satBoost, 0.0, 255.0);
  sat = floor(sat + 0.5);

  // Posterise.
  float step = 255.0 / (u_levels - 1.0);
  vec3 post = floor(floor(sat / step + 0.5) * step + 0.5);

  // Ben-Day dots.
  float lum = (0.2126 * post.r + 0.7152 * post.g + 0.0722 * post.b) / 255.0;
  float cellX = mod(x, u_dotSize);
  float cellY = mod(y, u_dotSize);
  float cx = u_dotSize * 0.5;
  float dist = length(vec2(cellX - cx, cellY - cx));
  float dotR = cx * (1.0 - lum);

  vec3 outCol = dist < dotR ? post / 255.0 : vec3(1.0);
  fragColor = vec4(outCol, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_dotSize", "u_levels", "u_satBoost",
  ] as const) };
  return _cache;
};

export const popArtGLAvailable = (): boolean => glAvailable();

export const renderPopArtGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  dotSize: number, levels: number, saturationBoost: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "popArt:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
    gl.uniform1f(cache.prog.uniforms.u_satBoost, saturationBoost);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
