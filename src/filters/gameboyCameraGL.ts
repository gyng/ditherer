import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Downscale → unsharp mask → contrast → 2×2 Bayer dither → 4-level
// quantise to the DMG green palette → upscale back. Each output pixel
// maps through the downscaled grid to a single source location, so the
// whole pipeline collapses into a single fragment shader.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;       // original (output) resolution
uniform vec2  u_downRes;   // downscaled resolution
uniform float u_contrast;
uniform float u_edgeEnhance;
uniform float u_ditherStrength;

const vec3 GB_0 = vec3(15.0,  56.0,  15.0);
const vec3 GB_1 = vec3(48.0,  98.0,  48.0);
const vec3 GB_2 = vec3(139.0, 172.0, 15.0);
const vec3 GB_3 = vec3(155.0, 188.0, 15.0);

// 2×2 Bayer matrix [y][x]
const float BAYER[4] = float[4](0.0/4.0, 2.0/4.0, 3.0/4.0, 1.0/4.0);

float lumaAtDown(float dx, float dy) {
  float cx = clamp(dx, 0.0, u_downRes.x - 1.0);
  float cy = clamp(dy, 0.0, u_downRes.y - 1.0);
  // Map back to source via round(dx * origW / downW) — nearest-neighbour.
  float sx = min(u_res.x - 1.0, floor(cx * u_res.x / u_downRes.x + 0.5));
  float sy = min(u_res.y - 1.0, floor(cy * u_res.y / u_downRes.y + 0.5));
  vec3 rgb = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
  return rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float dx = floor(min(u_downRes.x - 1.0, jsX * u_downRes.x / u_res.x));
  float dy = floor(min(u_downRes.y - 1.0, jsY * u_downRes.y / u_res.y));

  float gray = lumaAtDown(dx, dy);

  if (u_edgeEnhance > 0.0 && dx >= 1.0 && dx < u_downRes.x - 1.0 && dy >= 1.0 && dy < u_downRes.y - 1.0) {
    float nbr =
      lumaAtDown(dx - 1.0, dy - 1.0) +
      lumaAtDown(dx,       dy - 1.0) +
      lumaAtDown(dx + 1.0, dy - 1.0) +
      lumaAtDown(dx - 1.0, dy) +
      lumaAtDown(dx + 1.0, dy) +
      lumaAtDown(dx - 1.0, dy + 1.0) +
      lumaAtDown(dx,       dy + 1.0) +
      lumaAtDown(dx + 1.0, dy + 1.0);
    float blurred = nbr / 8.0;
    gray = gray + u_edgeEnhance * (gray - blurred);
  }

  gray = clamp(128.0 + (gray - 128.0) * u_contrast, 0.0, 255.0);

  int bx = int(mod(dx, 2.0));
  int by = int(mod(dy, 2.0));
  float bayer = BAYER[by * 2 + bx];
  float threshold = (bayer - 0.5) * u_ditherStrength * 255.0;
  float dithered = gray + threshold;

  vec3 palCol;
  if (dithered < 64.0)       palCol = GB_0;
  else if (dithered < 128.0) palCol = GB_1;
  else if (dithered < 192.0) palCol = GB_2;
  else                       palCol = GB_3;

  fragColor = vec4(palCol / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_downRes", "u_contrast", "u_edgeEnhance", "u_ditherStrength",
  ] as const) };
  return _cache;
};

export const gameboyCameraGLAvailable = (): boolean => glAvailable();

export const renderGameboyCameraGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  downW: number, downH: number,
  contrast: number, edgeEnhance: number, ditherStrength: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "gameboyCamera:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_downRes, downW, downH);
    gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
    gl.uniform1f(cache.prog.uniforms.u_edgeEnhance, edgeEnhance);
    gl.uniform1f(cache.prog.uniforms.u_ditherStrength, ditherStrength);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
