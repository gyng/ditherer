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

// Per-pixel LCD subpixel renderer: sample the cell-centre source colour once
// per pixel cell, then for this fragment determine which subpixel stripe /
// PenTile quadrant / diamond sector it belongs to and emit that single colour
// channel (times brightness). Gap pixels at the cell borders render a
// gap-darkness grey. Optional nearest-palette quantise in-shader.
const LCD_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_pixelSize;
uniform int   u_layout;       // 0 STRIPE, 1 PENTILE, 2 DIAMOND
uniform float u_brightness;
uniform float u_gapDarkness;
uniform float u_levels;

const float PI = 3.14159265;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y space to match the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  float subW = max(1.0, floor(u_pixelSize / 3.0));
  float halfP = floor(u_pixelSize / 2.0);

  // Sample the cell-centre source pixel.
  float gx = floor(x / u_pixelSize) * u_pixelSize + halfP;
  float gy = floor(y / u_pixelSize) * u_pixelSize + halfP;
  gx = min(u_res.x - 1.0, gx);
  gy = min(u_res.y - 1.0, gy);
  vec3 src = texture(u_source, vec2((gx + 0.5) / u_res.x, 1.0 - (gy + 0.5) / u_res.y)).rgb * 255.0;

  float localX = mod(x, u_pixelSize);
  float localY = mod(y, u_pixelSize);

  // Inter-cell gap (bottom-right 1px border).
  if (localX >= u_pixelSize - 1.0 || localY >= u_pixelSize - 1.0) {
    float g = floor(10.0 * (1.0 - u_gapDarkness) + 0.5);
    vec3 gapRgb = vec3(g / 255.0);
    fragColor = vec4(gapRgb, 1.0);
    return;
  }

  vec3 rgb = vec3(0.0);
  if (u_layout == 0) {
    // RGB stripe — subIdx ∈ {0, 1, 2} selects R, G, B.
    float subIdx = floor(localX / subW);
    if (subIdx < 0.5) rgb.r = src.r * u_brightness;
    else if (subIdx < 1.5) rgb.g = src.g * u_brightness;
    else rgb.b = src.b * u_brightness;
  } else if (u_layout == 1) {
    // PenTile — alternating RG / BG rows per cell-row.
    float isEvenRow = mod(floor(y / u_pixelSize), 2.0);
    float subIdx = floor(localX / subW);
    if (isEvenRow < 0.5) {
      if (subIdx < 0.5) rgb.r = src.r * u_brightness;
      else rgb.g = src.g * u_brightness;
    } else {
      if (subIdx < 0.5) rgb.b = src.b * u_brightness;
      else rgb.g = src.g * u_brightness;
    }
  } else {
    // Diamond — atan2 sector picks R (0–120°), G (120–240°), B (240–360°).
    float cx = localX - u_pixelSize * 0.5;
    float cy = localY - u_pixelSize * 0.5;
    float angleDeg = mod(atan(cy, cx) * 180.0 / PI + 360.0, 360.0);
    if (angleDeg < 120.0) rgb.r = src.r * u_brightness;
    else if (angleDeg < 240.0) rgb.g = src.g * u_brightness;
    else rgb.b = src.b * u_brightness;
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, LCD_FS, [
      "u_source", "u_res", "u_pixelSize", "u_layout",
      "u_brightness", "u_gapDarkness", "u_levels",
    ] as const),
  };
  return _cache;
};

export const lcdDisplayGLAvailable = (): boolean => glAvailable();

export const LCD_LAYOUT_ID: Record<string, number> = {
  STRIPE: 0,
  PENTILE: 1,
  DIAMOND: 2,
};

export const renderLcdDisplayGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  pixelSize: number,
  subpixelLayout: string,
  brightness: number,
  gapDarkness: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const layoutId = LCD_LAYOUT_ID[subpixelLayout];
  if (layoutId === undefined) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lcdDisplay:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_pixelSize, pixelSize);
    gl.uniform1i(cache.prog.uniforms.u_layout, layoutId);
    gl.uniform1f(cache.prog.uniforms.u_brightness, brightness);
    gl.uniform1f(cache.prog.uniforms.u_gapDarkness, gapDarkness);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
