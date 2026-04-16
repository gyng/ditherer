import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Cross-stitch tile pattern: sample a single source colour at each tile
// centre, draw two diagonal threads across the tile (d1 and d2 distance
// below a thickness-based threshold), with a darker outer shade for
// anti-aliased edges. Pixels in the gap between tiles or outside the
// stitch region get the fabric colour.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_stitchSize;
uniform float u_gapBetween;
uniform int   u_threadMode;   // 0 = source, 1 = palette-mapped — palette pass applied after readout
uniform vec3  u_fabricColor;  // 0..255

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  // Which tile?
  float cx = floor(jsX / u_stitchSize) * u_stitchSize;
  float cy = floor(jsY / u_stitchSize) * u_stitchSize;

  float startX = cx + u_gapBetween;
  float endX   = min(u_res.x, cx + u_stitchSize - u_gapBetween);
  float startY = cy + u_gapBetween;
  float endY   = min(u_res.y, cy + u_stitchSize - u_gapBetween);

  if (jsX < startX || jsX >= endX || jsY < startY || jsY >= endY) {
    fragColor = vec4(u_fabricColor / 255.0, 1.0);
    return;
  }

  float centreX = min(u_res.x - 1.0, cx + floor(u_stitchSize * 0.5));
  float centreY = min(u_res.y - 1.0, cy + floor(u_stitchSize * 0.5));
  vec3 thread = texture(u_source, vec2((centreX + 0.5) / u_res.x, 1.0 - (centreY + 0.5) / u_res.y)).rgb * 255.0;

  float localX = jsX - cx;
  float localY = jsY - cy;
  float maxCoord = u_stitchSize - 1.0;
  float d1 = abs(localX - localY);
  float d2 = abs(localX + localY - maxCoord);
  float thickness = max(0.6, u_stitchSize * 0.08);

  if (d1 <= thickness || d2 <= thickness) {
    float shade = (d1 <= thickness * 0.5 || d2 <= thickness * 0.5) ? 0.92 : 0.75;
    vec3 outRgb = floor(thread * shade + 0.5);
    fragColor = vec4(outRgb / 255.0, 1.0);
  } else {
    fragColor = vec4(u_fabricColor / 255.0, 1.0);
  }
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_stitchSize", "u_gapBetween", "u_threadMode", "u_fabricColor",
  ] as const) };
  return _cache;
};

export const crossStitchGLAvailable = (): boolean => glAvailable();

export const renderCrossStitchGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  stitchSize: number, gapBetween: number,
  fabricColor: [number, number, number],
  threadModeIsPalette: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "crossStitch:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_stitchSize, stitchSize);
    gl.uniform1f(cache.prog.uniforms.u_gapBetween, gapBetween);
    gl.uniform1i(cache.prog.uniforms.u_threadMode, threadModeIsPalette ? 1 : 0);
    gl.uniform3f(cache.prog.uniforms.u_fabricColor, fabricColor[0], fabricColor[1], fabricColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
