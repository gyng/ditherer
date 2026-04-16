import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Single-pass contour: compute the current pixel's luma band, scan a
// disk (radius ≤ 5 pixels — lineWidth tops out at 4 in the JS
// reference), and flag the pixel as an edge if any neighbour sits in a
// different band. Fill mode selects lines, filled bands, or both.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_levels;
uniform float u_lineWidth;
uniform float u_reach;
uniform int   u_ceilRadius;
uniform vec3  u_lineColor;   // 0..255
uniform int   u_fillMode;    // 0 = lines only, 1 = filled bands, 2 = both

float lumaBandAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  vec3 c = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb;
  float lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return min(u_levels - 1.0, floor(lum * u_levels));
}

vec3 colourAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float band = lumaBandAt(jsX, jsY);
  vec3 src = colourAt(jsX, jsY);

  bool isEdge = false;
  for (int ky = -5; ky <= 5; ky++) {
    if (ky < -u_ceilRadius || ky > u_ceilRadius) continue;
    for (int kx = -5; kx <= 5; kx++) {
      if (kx < -u_ceilRadius || kx > u_ceilRadius) continue;
      if (kx == 0 && ky == 0) continue;
      float h = sqrt(float(kx * kx + ky * ky));
      if (h > u_reach) continue;
      float nb = lumaBandAt(jsX + float(kx), jsY + float(ky));
      if (nb != band) { isEdge = true; break; }
    }
    if (isEdge) break;
  }

  float edgeAlpha = clamp(u_lineWidth, 0.1, 1.0);
  float t = (band + 0.5) / u_levels;

  vec3 outRgb;
  if (isEdge && u_fillMode != 1) {
    vec3 base;
    if (u_fillMode == 0) {
      base = vec3(255.0);
    } else {
      base = src * (t + (1.0 - t) * 0.3);
    }
    vec3 blended = base + (u_lineColor - base) * edgeAlpha;
    outRgb = floor(blended + 0.5);
  } else if (u_fillMode != 0) {
    outRgb = floor(src * (t + (1.0 - t) * 0.3) + 0.5);
  } else {
    outRgb = vec3(255.0);
  }
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_levels", "u_lineWidth", "u_reach", "u_ceilRadius",
    "u_lineColor", "u_fillMode",
  ] as const) };
  return _cache;
};

export const contourLinesGLAvailable = (): boolean => glAvailable();

export type ContourFillMode = 0 | 1 | 2;

export const renderContourLinesGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  levels: number, lineWidth: number,
  lineColor: [number, number, number],
  fillMode: ContourFillMode,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "contourLines:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const radius = Math.max(1, lineWidth);
  const ceilRadius = Math.min(5, Math.ceil(radius));
  const reach = radius + 0.35;
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
    gl.uniform1f(cache.prog.uniforms.u_lineWidth, lineWidth);
    gl.uniform1f(cache.prog.uniforms.u_reach, reach);
    gl.uniform1i(cache.prog.uniforms.u_ceilRadius, ceilRadius);
    gl.uniform3f(cache.prog.uniforms.u_lineColor, lineColor[0], lineColor[1], lineColor[2]);
    gl.uniform1i(cache.prog.uniforms.u_fillMode, fillMode);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
