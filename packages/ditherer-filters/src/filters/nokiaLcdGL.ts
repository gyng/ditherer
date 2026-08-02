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
uniform float u_ditherStrength;
uniform int   u_pixelGrid;

const vec3 PIXEL_ON  = vec3(67.0,  82.0,  61.0);
const vec3 PIXEL_OFF = vec3(199.0, 207.0, 161.0);

vec4 sampleJs(vec2 position) {
  vec2 p = clamp(position, vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2((p.x + 0.5) / u_res.x, 1.0 - (p.y + 0.5) / u_res.y));
}

int bayer4(int x, int y) {
  const int matrix[16] = int[16](
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  );
  return matrix[(y & 3) * 4 + (x & 3)];
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float dx = floor(min(u_downRes.x - 1.0, jsX * u_downRes.x / u_res.x));
  float dy = floor(min(u_downRes.y - 1.0, jsY * u_downRes.y / u_res.y));

  vec2 cellSize = u_res / u_downRes;
  vec2 sourceCenter = (vec2(dx, dy) + 0.5) * cellSize - 0.5;
  vec2 sampleOffset = cellSize * 0.24;
  vec4 center = sampleJs(sourceCenter);
  vec3 src = center.rgb * 0.4;
  src += sampleJs(sourceCenter + vec2(sampleOffset.x, 0.0)).rgb * 0.15;
  src += sampleJs(sourceCenter - vec2(sampleOffset.x, 0.0)).rgb * 0.15;
  src += sampleJs(sourceCenter + vec2(0.0, sampleOffset.y)).rgb * 0.15;
  src += sampleJs(sourceCenter - vec2(0.0, sampleOffset.y)).rgb * 0.15;
  src *= 255.0;

  float luma = src.r * 0.2126 + src.g * 0.7152 + src.b * 0.0722;
  float adjusted = clamp(128.0 + (luma - 128.0) * u_contrast, 0.0, 255.0);
  float matrixOffset = ((float(bayer4(int(dx), int(dy))) + 0.5) / 16.0 - 0.5)
    * clamp(u_ditherStrength, 0.0, 1.0);
  bool pixelActive = adjusted / 255.0 < u_threshold / 255.0 + matrixOffset;
  vec3 base = pixelActive ? PIXEL_ON : PIXEL_OFF;

  // Inter-pixel gaps reveal the unenergized LCD background; they do not
  // invent darker third/fourth optical states. Suppress a grid axis until a
  // one-output-pixel gap is narrow enough not to dominate the active cell.
  if (u_pixelGrid == 1) {
    float cellW = u_res.x / u_downRes.x;
    float cellH = u_res.y / u_downRes.y;
    float previousDx = floor(min(u_downRes.x - 1.0, max(0.0, jsX - 1.0) * u_downRes.x / u_res.x));
    float previousDy = floor(min(u_downRes.y - 1.0, max(0.0, jsY - 1.0) * u_downRes.y / u_res.y));
    bool atV = cellW >= 6.0 && jsX > 0.0 && dx != previousDx;
    bool atH = cellH >= 6.0 && jsY > 0.0 && dy != previousDy;
    if (atV || atH) base = PIXEL_OFF;
  }

  fragColor = vec4(base / 255.0, texture(u_source, v_uv).a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source",
      "u_res",
      "u_downRes",
      "u_threshold",
      "u_contrast",
      "u_ditherStrength",
      "u_pixelGrid",
    ] as const),
  };
  return _cache;
};

export const nokiaLcdGLAvailable = (): boolean => glAvailable();

export const renderNokiaLcdGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  columns: number,
  rows: number,
  threshold: number,
  contrast: number,
  ditherStrength: number,
  pixelGrid: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "nokiaLcd:source", width, height);
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
      gl.uniform2f(cache.prog.uniforms.u_downRes, columns, rows);
      gl.uniform1f(cache.prog.uniforms.u_threshold, threshold);
      gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
      gl.uniform1f(cache.prog.uniforms.u_ditherStrength, ditherStrength);
      gl.uniform1i(cache.prog.uniforms.u_pixelGrid, pixelGrid ? 1 : 0);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
