import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

// Two-mode per-pixel row transform:
//   DARKEN       — scale RGB by u_intensity when y % u_gap < u_height
//   RGB_SUBLINES — keep only one of R/G/B per row group (phosphor look)
// Optional nearest-palette quantise matches other GL filter ports.
const SCANLINE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;         // 0 DARKEN, 1 RGB_SUBLINES
uniform float u_intensity;
uniform float u_gap;
uniform float u_height;
uniform float u_lineHeight;
uniform float u_brightness;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y space so DARKEN's y % gap matches the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y));
  vec3 c255 = src.rgb * 255.0;

  vec3 rgb;
  if (u_mode == 0) {
    float scale = mod(y, u_gap) < u_height ? u_intensity : 1.0;
    rgb = c255 * scale;
  } else {
    float grp = mod(floor(y / max(1.0, u_lineHeight)), 3.0);
    if (grp < 0.5)      rgb = vec3(min(255.0, floor(c255.r * u_brightness + 0.5)), 0.0, 0.0);
    else if (grp < 1.5) rgb = vec3(0.0, min(255.0, floor(c255.g * u_brightness + 0.5)), 0.0);
    else                rgb = vec3(0.0, 0.0, min(255.0, floor(c255.b * u_brightness + 0.5)));
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, SCANLINE_FS, [
      "u_source", "u_res", "u_mode", "u_intensity", "u_gap", "u_height",
      "u_lineHeight", "u_brightness", "u_levels",
    ] as const),
  };
  return _cache;
};

export const scanlineGLAvailable = (): boolean => glAvailable();

export const SCANLINE_MODE_ID: Record<string, number> = { DARKEN: 0, RGB_SUBLINES: 1 };

export const renderScanlineGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  mode: string,
  intensity: number,
  gap: number,
  hgt: number,
  lineHeight: number,
  brightness: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const modeId = SCANLINE_MODE_ID[mode];
  if (modeId === undefined) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "scanline:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_mode, modeId);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
    gl.uniform1f(cache.prog.uniforms.u_gap, gap);
    gl.uniform1f(cache.prog.uniforms.u_height, hgt);
    gl.uniform1f(cache.prog.uniforms.u_lineHeight, lineHeight);
    gl.uniform1f(cache.prog.uniforms.u_brightness, brightness);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
