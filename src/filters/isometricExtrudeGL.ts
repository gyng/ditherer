import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Inverts the CPU painter's algorithm: for each output pixel (ox, oy), the
// winning source is at (ox - stepX*d, oy - stepY*d) for the LARGEST d in
// [0, depth] whose source is above the luma threshold. d=0 paints palette
// colour; d>=1 paints shaded wall. Works for all four directions because
// the CPU iteration order always places larger-d shadows later.
const IE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_depth;
uniform vec2  u_step;          // (stepX, stepY) in JS-y: stepY>0 is down
uniform float u_threshold;     // 0..255
uniform vec3  u_shadowColor;   // 0..1
uniform float u_shadeFalloff;

const int MAX_DEPTH = 24;

vec4 sampleJS(float jx, float jy) {
  if (jx < 0.0 || jx >= u_res.x || jy < 0.0 || jy >= u_res.y) return vec4(0.0);
  return texture(u_source, vec2((jx + 0.5) / u_res.x, 1.0 - (jy + 0.5) / u_res.y));
}

void main() {
  vec2 px = v_uv * u_res;
  float ox = floor(px.x);
  float oy = u_res.y - 1.0 - floor(px.y);

  vec4 outCol = vec4(0.0);
  float depthF = float(u_depth);

  for (int d = MAX_DEPTH; d >= 0; d--) {
    if (d > u_depth) continue;
    float fd = float(d);
    float sx = ox - u_step.x * fd;
    float sy = oy - u_step.y * fd;
    vec4 srcCol = sampleJS(sx, sy);
    if (srcCol.a == 0.0) continue;
    float lum = (0.2126 * srcCol.r + 0.7152 * srcCol.g + 0.0722 * srcCol.b) * 255.0;
    if (lum < u_threshold) continue;

    if (d == 0) {
      outCol = srcCol;
    } else {
      float shade = pow(1.0 - fd / (depthF + 1.0), 1.0 - u_shadeFalloff);
      vec3 wall = u_shadowColor * (0.4 + shade * 0.6);
      outCol = vec4(wall, srcCol.a);
    }
    break;
  }

  fragColor = outCol;
}
`;

type Cache = { ie: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ie: linkProgram(gl, IE_FS, [
      "u_source", "u_res", "u_depth", "u_step", "u_threshold",
      "u_shadowColor", "u_shadeFalloff",
    ] as const),
  };
  return _cache;
};

export const isometricExtrudeGLAvailable = (): boolean => glAvailable();

export const renderIsometricExtrudeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  depth: number,
  stepX: number,
  stepY: number,
  threshold: number,
  shadowColor: number[],
  shadeFalloff: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "isoExtrude:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.ie, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.ie.uniforms.u_source, 0);
    gl.uniform2f(cache.ie.uniforms.u_res, width, height);
    gl.uniform1i(cache.ie.uniforms.u_depth, Math.min(24, Math.max(0, depth)));
    gl.uniform2f(cache.ie.uniforms.u_step, stepX, stepY);
    gl.uniform1f(cache.ie.uniforms.u_threshold, threshold);
    gl.uniform3f(
      cache.ie.uniforms.u_shadowColor,
      shadowColor[0] / 255, shadowColor[1] / 255, shadowColor[2] / 255,
    );
    gl.uniform1f(cache.ie.uniforms.u_shadeFalloff, shadeFalloff);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
