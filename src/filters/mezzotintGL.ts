import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Mezzotint: each dotSize×dotSize block gets a deterministic mulberry32
// roll against (1-luminance)*density. Hits paint a dot in the source
// colour, misses leave the paper white. The mulberry32 first-call maths
// are reproduced in GLSL uint32 so output matches the JS reference
// exactly when dotSize and density align on identical pixels.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_density;
uniform float u_dotSize;

float mulberryFirst(int seed) {
  uint s = uint(seed) + 0x6D2B79F5u;
  uint t = (s ^ (s >> 15u)) * (1u | s);
  t = ((t ^ (t >> 7u)) * (61u | t)) ^ t;
  t = t ^ (t >> 14u);
  return float(t) / 4294967296.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float ds = max(1.0, u_dotSize);
  float bx = floor(jsX / ds) * ds;
  float by = floor(jsY / ds) * ds;

  float sx = min(u_res.x - 1.0, bx);
  float sy = min(u_res.y - 1.0, by);
  vec3 src = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb;

  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float darkness = 1.0 - lum;

  int seed = int(bx) * 31 + int(by) * 997 + 42;
  float v = mulberryFirst(seed);
  bool hit = v < darkness * u_density;

  vec3 outCol = hit ? src : vec3(1.0);
  fragColor = vec4(outCol, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_density", "u_dotSize",
  ] as const) };
  return _cache;
};

export const mezzotintGLAvailable = (): boolean => glAvailable();

export const renderMezzotintGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  density: number, dotSize: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "mezzotint:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_density, density);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
