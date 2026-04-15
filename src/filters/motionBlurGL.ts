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

// Directional line integrator: averages `length + 1` bilinear samples along
// the (cos angle, sin angle) direction, clamped to the source edges via
// CLAMP_TO_EDGE. GL_LINEAR provides the bilinear filtering the JS reference
// implements by hand. Optional nearest-palette quantisation.
const MOTION_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dx;
uniform float u_dy;
uniform int   u_halfLen;  // length / 2, integer floor; kernel is 2*halfLen+1
uniform float u_levels;

void main() {
  // Work in JS-y pixel space throughout so dy = sin(angle) has the same sign
  // convention as the CPU reference (angle=90 → blur downward in display).
  vec2 px = v_uv * u_res;
  float baseX = floor(px.x) + 0.5;
  float baseY = u_res.y - 0.5 - floor(px.y);

  vec4 acc = vec4(0.0);
  float count = 0.0;
  for (int t = -50; t <= 50; t++) {
    if (t < -u_halfLen || t > u_halfLen) continue;
    float sx = baseX + float(t) * u_dx;
    float sy = baseY + float(t) * u_dy;
    vec2 uv = vec2(sx / u_res.x, 1.0 - sy / u_res.y);
    acc += texture(u_source, clamp(uv, vec2(0.0), vec2(1.0)));
    count += 1.0;
  }

  vec4 avg = acc / count;
  vec3 rgb = avg.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, avg.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, MOTION_BLUR_FS, [
      "u_source", "u_res", "u_dx", "u_dy", "u_halfLen", "u_levels",
    ] as const),
  };
  return _cache;
};

export const motionBlurGLAvailable = (): boolean => glAvailable();

export const renderMotionBlurGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  angle: number,
  length: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const halfLenInt = Math.floor(length / 2);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "motionBlur:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dx, dx);
    gl.uniform1f(cache.prog.uniforms.u_dy, dy);
    gl.uniform1i(cache.prog.uniforms.u_halfLen, halfLenInt);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
