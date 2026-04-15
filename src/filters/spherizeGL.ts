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

// Per-pixel spherical remap: each output pixel maps to a source coordinate
// warped radially around (centerX, centerY) within effectR. Pixels outside the
// radius pass through. Bilinear filtering is handled by GL_LINEAR on the
// source texture. Optional nearest-palette quantisation matches the JS path.
const SPHERIZE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strength;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_radius;
uniform float u_levels;  // >1 = nearest-palette quantise

void main() {
  float W = u_res.x;
  float H = u_res.y;
  float x = floor(v_uv.x * W);
  // UNPACK_FLIP_Y=true; compute JS-y for identical mapping to the CPU path.
  float y = H - 1.0 - floor(v_uv.y * H);

  float cx = W * u_centerX;
  float cy = H * u_centerY;
  float maxDim = max(W, H);
  float effectR = u_radius * maxDim * 0.5;

  float dx = x - cx;
  float dy = y - cy;
  float dist = sqrt(dx * dx + dy * dy);

  vec2 samplePx;
  if (dist >= effectR || effectR < 1.0) {
    samplePx = vec2(x, y);
  } else {
    float normDist = dist / effectR;
    float newDist = u_strength > 0.0
      ? pow(normDist, 1.0 + u_strength) * effectR
      : pow(normDist, 1.0 / (1.0 - u_strength)) * effectR;
    float scale = dist > 0.0 ? newDist / dist : 1.0;
    float sx = cx + dx * scale;
    float sy = cy + dy * scale;
    sx = clamp(sx, 0.0, W - 1.0);
    sy = clamp(sy, 0.0, H - 1.0);
    samplePx = vec2(sx, sy);
  }

  // UNPACK_FLIP_Y=true: JS row N → texture uv.y = 1 - (N + 0.5)/H.
  vec2 sampleUV = vec2((samplePx.x + 0.5) / W, 1.0 - (samplePx.y + 0.5) / H);
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
    prog: linkProgram(gl, SPHERIZE_FS, [
      "u_source", "u_res", "u_strength", "u_centerX", "u_centerY", "u_radius", "u_levels",
    ] as const),
  };
  return _cache;
};

export const spherizeGLAvailable = (): boolean => glAvailable();

export const renderSpherizeGL = (
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
  const sourceTex = ensureTexture(gl, "spherize:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  // Linear filtering for bilinear sample inside the radius.
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
