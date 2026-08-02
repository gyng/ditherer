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
} from "../gl/index";

// Magnified emitter renderer. RGB stripe uses equal thirds; PenTile uses one
// green plus an alternating shared red/blue emitter per logical cell; Diamond
// uses two smaller green diamonds and one red/blue diamond each.
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

float diamondDistance(vec2 p, vec2 center) {
  return abs(p.x - center.x) + abs(p.y - center.y);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y space to match the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  float halfP = floor(u_pixelSize / 2.0);

  // Sample the cell-centre source pixel.
  float gx = floor(x / u_pixelSize) * u_pixelSize + halfP;
  float gy = floor(y / u_pixelSize) * u_pixelSize + halfP;
  gx = min(u_res.x - 1.0, gx);
  gy = min(u_res.y - 1.0, gy);
  vec4 cellSample = texture(u_source, vec2((gx + 0.5) / u_res.x, 1.0 - (gy + 0.5) / u_res.y));
  vec3 src = cellSample.rgb * cellSample.a * 255.0;

  vec2 local = vec2(mod(x, u_pixelSize), mod(y, u_pixelSize)) / u_pixelSize;
  float cellX = floor(x / u_pixelSize);
  float cellY = floor(y / u_pixelSize);
  float matrix = 0.12 * (1.0 - u_gapDarkness);
  float alpha = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).a;

  vec3 rgb = vec3(0.0);
  if (u_layout == 0) {
    float stripe = local.x * 3.0;
    float withinStripe = fract(stripe);
    bool matrixGap = local.y < 0.06 || local.y > 0.94 || withinStripe < 0.06 || withinStripe > 0.94;
    if (matrixGap) rgb = vec3(matrix * 255.0);
    else if (stripe < 1.0) rgb.r = src.r * u_brightness;
    else if (stripe < 2.0) rgb.g = src.g * u_brightness;
    else rgb.b = src.b * u_brightness;
  } else if (u_layout == 1) {
    bool matrixGap = local.x < 0.06 || local.x > 0.94 || local.y < 0.06 || local.y > 0.94
      || abs(local.x - 0.5) < 0.05;
    if (matrixGap) rgb = vec3(matrix * 255.0);
    else if (local.x >= 0.5) rgb.g = src.g * u_brightness;
    else if (mod(cellX + cellY, 2.0) < 0.5) rgb.r = src.r * u_brightness;
    else rgb.b = src.b * u_brightness;
  } else {
    if (diamondDistance(local, vec2(0.5, 0.25)) <= 0.18
        || diamondDistance(local, vec2(0.5, 0.75)) <= 0.18) {
      rgb.g = src.g * u_brightness;
    } else if (diamondDistance(local, vec2(0.25, 0.5)) <= 0.22) {
      rgb.r = src.r * u_brightness;
    } else if (diamondDistance(local, vec2(0.75, 0.5)) <= 0.22) {
      rgb.b = src.b * u_brightness;
    } else {
      rgb = vec3(matrix * 255.0);
    }
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, alpha);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, LCD_FS, [
      "u_source",
      "u_res",
      "u_pixelSize",
      "u_layout",
      "u_brightness",
      "u_gapDarkness",
      "u_levels",
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

  drawPass(
    gl,
    null,
    width,
    height,
    cache.prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.prog.uniforms.u_source, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1f(cache.prog.uniforms.u_pixelSize, pixelSize);
      gl.uniform1i(cache.prog.uniforms.u_layout, layoutId);
      gl.uniform1f(cache.prog.uniforms.u_brightness, brightness);
      gl.uniform1f(cache.prog.uniforms.u_gapDarkness, gapDarkness);
      gl.uniform1f(cache.prog.uniforms.u_levels, levels);
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
