import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Downscale → contrast → 1-bit threshold → Nokia 3310 monochrome
// palette → upscale back, with optional cell-boundary grid darkening.
// The JS reference samples the downscaled grid with nearest-neighbour
// lookups; in GL each fragment maps once to its source cell.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;       // original (output) resolution
uniform vec2  u_downRes;   // LCD columns × rows
uniform float u_threshold;
uniform float u_contrast;
uniform int   u_pixelGrid;

const vec3 PIXEL_ON  = vec3(67.0,  82.0,  61.0);
const vec3 PIXEL_OFF = vec3(199.0, 207.0, 161.0);

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float dx = floor(min(u_downRes.x - 1.0, jsX * u_downRes.x / u_res.x));
  float dy = floor(min(u_downRes.y - 1.0, jsY * u_downRes.y / u_res.y));

  float sx = min(u_res.x - 1.0, floor(dx * u_res.x / u_downRes.x + 0.5));
  float sy = min(u_res.y - 1.0, floor(dy * u_res.y / u_downRes.y + 0.5));
  vec3 src = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;

  float luma = src.r * 0.2126 + src.g * 0.7152 + src.b * 0.0722;
  float adjusted = clamp(128.0 + (luma - 128.0) * u_contrast, 0.0, 255.0);
  vec3 base = adjusted < u_threshold ? PIXEL_ON : PIXEL_OFF;

  // Cell-boundary grid: darken pixels where (x % cellW) < 1 or (y % cellH) < 1.
  if (u_pixelGrid == 1) {
    float cellW = u_res.x / u_downRes.x;
    float cellH = u_res.y / u_downRes.y;
    bool atV = mod(jsX, cellW) < 1.0;
    bool atH = mod(jsY, cellH) < 1.0;
    if (atV || atH) base = floor(base * 0.75 + 0.5);
  }

  fragColor = vec4(base / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_downRes", "u_threshold", "u_contrast", "u_pixelGrid",
  ] as const) };
  return _cache;
};

export const nokiaLcdGLAvailable = (): boolean => glAvailable();

export const renderNokiaLcdGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  columns: number, rows: number,
  threshold: number, contrast: number, pixelGrid: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "nokiaLcd:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_downRes, columns, rows);
    gl.uniform1f(cache.prog.uniforms.u_threshold, threshold);
    gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
    gl.uniform1i(cache.prog.uniforms.u_pixelGrid, pixelGrid ? 1 : 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
