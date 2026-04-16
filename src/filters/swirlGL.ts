import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Radial swirl with quadratic falloff, bilinear source sampling. Pixels
// outside the effect radius pass through unchanged. JS-orientation
// coordinates so the centre matches the reference position exactly.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_centre;      // JS-y
uniform float u_radius;
uniform float u_angle;       // radians

vec4 sampleBilinear(vec2 p) {
  // p is in JS (x, y) where (0,0) is top-left.
  vec2 p0 = floor(p);
  vec2 f = p - p0;
  vec2 p1 = p0 + 1.0;
  vec2 c0 = clamp(p0, vec2(0.0), u_res - 1.0);
  vec2 c1 = clamp(p1, vec2(0.0), u_res - 1.0);
  vec2 uv00 = vec2((c0.x + 0.5) / u_res.x, 1.0 - (c0.y + 0.5) / u_res.y);
  vec2 uv10 = vec2((c1.x + 0.5) / u_res.x, 1.0 - (c0.y + 0.5) / u_res.y);
  vec2 uv01 = vec2((c0.x + 0.5) / u_res.x, 1.0 - (c1.y + 0.5) / u_res.y);
  vec2 uv11 = vec2((c1.x + 0.5) / u_res.x, 1.0 - (c1.y + 0.5) / u_res.y);
  vec4 a00 = texture(u_source, uv00);
  vec4 a10 = texture(u_source, uv10);
  vec4 a01 = texture(u_source, uv01);
  vec4 a11 = texture(u_source, uv11);
  return (a00 * (1.0 - f.x) + a10 * f.x) * (1.0 - f.y)
       + (a01 * (1.0 - f.x) + a11 * f.x) * f.y;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec2 d = vec2(jsX - u_centre.x, jsY - u_centre.y);
  float dist = length(d);

  vec2 src;
  if (u_radius > 0.0 && dist < u_radius) {
    float t = 1.0 - dist / u_radius;
    float theta = u_angle * t * t;
    float c = cos(theta);
    float s = sin(theta);
    src = u_centre + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  } else {
    src = vec2(jsX, jsY);
  }

  fragColor = sampleBilinear(src);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_centre", "u_radius", "u_angle",
  ] as const) };
  return _cache;
};

export const swirlGLAvailable = (): boolean => glAvailable();

export const renderSwirlGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  centreX: number, centreY: number, radius: number, angleRad: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "swirl:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_centre, centreX, centreY);
    gl.uniform1f(cache.prog.uniforms.u_radius, radius);
    gl.uniform1f(cache.prog.uniforms.u_angle, angleRad);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
