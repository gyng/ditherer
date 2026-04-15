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

// Radial pinch/bulge: pixels inside the effect radius are sampled from a
// displaced source position where normDist is remapped via pow(normDist,
// 1 - strength). GL_LINEAR provides the bilinear the CPU path does by hand.
const PINCH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strength;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_radius;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y for identical math to the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  float cx = u_res.x * u_centerX;
  float cy = u_res.y * u_centerY;
  float effectR = u_radius * max(u_res.x, u_res.y) * 0.5;

  float dx = x - cx;
  float dy = y - cy;
  float dist = sqrt(dx * dx + dy * dy);

  vec2 samplePx;
  if (dist >= effectR || effectR < 1.0) {
    samplePx = vec2(x, y);
  } else {
    float normDist = dist / effectR;
    float pinched = pow(normDist, 1.0 - u_strength);
    float newDist = pinched * effectR;
    float scale = dist > 0.0 ? newDist / dist : 1.0;
    float sx = clamp(cx + dx * scale, 0.0, u_res.x - 1.0);
    float sy = clamp(cy + dy * scale, 0.0, u_res.y - 1.0);
    samplePx = vec2(sx, sy);
  }

  vec2 sampleUV = vec2((samplePx.x + 0.5) / u_res.x, 1.0 - (samplePx.y + 0.5) / u_res.y);
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
    prog: linkProgram(gl, PINCH_FS, [
      "u_source", "u_res", "u_strength", "u_centerX", "u_centerY", "u_radius", "u_levels",
    ] as const),
  };
  return _cache;
};

export const pinchGLAvailable = (): boolean => glAvailable();

export const renderPinchGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  strength: number,
  centerX: number,
  centerY: number,
  radius: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "pinch:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_strength, strength);
    gl.uniform1f(cache.prog.uniforms.u_centerX, centerX);
    gl.uniform1f(cache.prog.uniforms.u_centerY, centerY);
    gl.uniform1f(cache.prog.uniforms.u_radius, radius);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
