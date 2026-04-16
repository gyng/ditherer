import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-channel Bayer-dithered posterise. The Bayer matrix is expanded
// on CPU and uploaded as a 0..1 float array; matrix size picks which
// prefix is active. Covers 2×2, 4×4, 8×8.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_bayer[64];   // normalised 0..1
uniform int   u_matrixN;     // 2, 4, or 8
uniform float u_levelsR;
uniform float u_levelsG;
uniform float u_levelsB;

float bayerAt(int bx, int by) {
  // Matrix is stored row-major in 8×8 space; for smaller N we only
  // fill the top-left NxN block of that 8×8 array on the JS side.
  return u_bayer[by * 8 + bx];
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 c = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));
  int bx = int(mod(jsX, float(u_matrixN)));
  int by = int(mod(jsY, float(u_matrixN)));
  float threshold = bayerAt(bx, by) - 0.5;

  float rIn = c.r + threshold / u_levelsR;
  float gIn = c.g + threshold / u_levelsG;
  float bIn = c.b + threshold / u_levelsB;

  float r = clamp(floor(rIn * (u_levelsR - 1.0) + 0.5) / (u_levelsR - 1.0), 0.0, 1.0);
  float g = clamp(floor(gIn * (u_levelsG - 1.0) + 0.5) / (u_levelsG - 1.0), 0.0, 1.0);
  float b = clamp(floor(bIn * (u_levelsB - 1.0) + 0.5) / (u_levelsB - 1.0), 0.0, 1.0);
  // Match JS's final *255 round-trip (integer RGB bytes).
  r = floor(r * 255.0 + 0.5) / 255.0;
  g = floor(g * 255.0 + 0.5) / 255.0;
  b = floor(b * 255.0 + 0.5) / 255.0;
  fragColor = vec4(r, g, b, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_bayer[0]", "u_matrixN",
    "u_levelsR", "u_levelsG", "u_levelsB",
  ] as const) };
  return _cache;
};

export const posterizeDitherGLAvailable = (): boolean => glAvailable();

export const renderPosterizeDitherGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  matrix: number[][], matrixN: number,
  levelsR: number, levelsG: number, levelsB: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  // Pack matrix into 8×8 float array, normalised to 0..1.
  const maxVal = matrixN * matrixN;
  const flat = new Float32Array(64);
  for (let y = 0; y < matrixN; y++) {
    for (let x = 0; x < matrixN; x++) {
      flat[y * 8 + x] = matrix[y][x] / maxVal;
    }
  }

  const sourceTex = ensureTexture(gl, "posterizeDither:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1fv(cache.prog.uniforms["u_bayer[0]"], flat);
    gl.uniform1i(cache.prog.uniforms.u_matrixN, matrixN);
    gl.uniform1f(cache.prog.uniforms.u_levelsR, levelsR);
    gl.uniform1f(cache.prog.uniforms.u_levelsG, levelsG);
    gl.uniform1f(cache.prog.uniforms.u_levelsB, levelsB);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
