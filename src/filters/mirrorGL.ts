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

// Per-pixel source-coordinate remap: horizontal/vertical/both flip or
// kaleidoscope slice fold. Nearest-neighbour sampling matches JS round(cx +
// cos(angle)*dist). Optional nearest-palette quantisation.
const MIRROR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_mode;        // 0 H, 1 V, 2 Both, 3 Kaleidoscope
uniform int   u_segments;
uniform float u_cx;
uniform float u_cy;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y pixel space so the flip math matches the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  float sx = x;
  float sy = y;

  if (u_mode == 3) {
    float dx = x - u_cx;
    float dy = y - u_cy;
    float angle = atan(dy, dx);
    float dist = sqrt(dx * dx + dy * dy);
    float sliceAngle = 6.28318530718 / float(u_segments);
    // Fold into first slice, then reflect upper half.
    angle = mod(mod(angle, sliceAngle) + sliceAngle, sliceAngle);
    if (angle > sliceAngle * 0.5) angle = sliceAngle - angle;
    sx = floor(u_cx + cos(angle) * dist + 0.5);
    sy = floor(u_cy + sin(angle) * dist + 0.5);
  } else {
    if ((u_mode == 0 || u_mode == 2) && x > u_cx) sx = floor(2.0 * u_cx - x + 0.5);
    if ((u_mode == 1 || u_mode == 2) && y > u_cy) sy = floor(2.0 * u_cy - y + 0.5);
  }

  sx = clamp(sx, 0.0, u_res.x - 1.0);
  sy = clamp(sy, 0.0, u_res.y - 1.0);

  // UNPACK_FLIP_Y: JS-row N → uv.y = 1 - (N+0.5)/H.
  vec2 sampleUV = vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y);
  vec4 sampled = texture(u_source, sampleUV);
  vec3 rgb = sampled.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, sampled.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, MIRROR_FS, [
      "u_source", "u_res", "u_mode", "u_segments", "u_cx", "u_cy", "u_levels",
    ] as const),
  };
  return _cache;
};

export const mirrorGLAvailable = (): boolean => glAvailable();

export const MIRROR_MODE_ID: Record<string, number> = {
  HORIZONTAL: 0,
  VERTICAL: 1,
  BOTH: 2,
  KALEIDOSCOPE: 3,
};

export const renderMirrorGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  mode: string,
  segments: number,
  offsetX: number,
  offsetY: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const modeId = MIRROR_MODE_ID[mode];
  if (modeId === undefined) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const cx = width * (0.5 + offsetX * 0.5);
  const cy = height * (0.5 + offsetY * 0.5);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "mirror:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_mode, modeId);
    gl.uniform1i(cache.prog.uniforms.u_segments, segments);
    gl.uniform1f(cache.prog.uniforms.u_cx, cx);
    gl.uniform1f(cache.prog.uniforms.u_cy, cy);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
