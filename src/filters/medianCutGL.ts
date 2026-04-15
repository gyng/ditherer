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

// Median-cut "apply" pass: for each source pixel, find nearest colour from a
// pre-computed palette (up to MAX_PALETTE entries, built on CPU). The palette
// tree build stays on the JS side — it's recursive and small relative to the
// per-pixel nearest-colour scan that dominates wall time on larger canvases.
export const MAX_PALETTE = 32;

const MEDIAN_CUT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_count;                // number of valid palette entries
uniform vec3  u_palette[${MAX_PALETTE}]; // 0..255 range (matches JS palette values)

void main() {
  // Sample the exact centre of the JS-pixel; alpha is preserved from source.
  vec2 px = v_uv * u_res;
  vec4 src = texture(u_source, (floor(px) + 0.5) / u_res);
  vec3 c255 = src.rgb * 255.0;

  int bestIdx = 0;
  float bestDist = 1e20;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= u_count) break;
    vec3 d = c255 - u_palette[i];
    float dist = dot(d, d);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  vec3 best = u_palette[0];
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i == bestIdx) { best = u_palette[i]; }
  }
  fragColor = vec4(best / 255.0, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, MEDIAN_CUT_FS, ["u_source", "u_res", "u_count", "u_palette[0]"] as const),
  };
  return _cache;
};

export const medianCutGLAvailable = (): boolean => glAvailable();

export const renderMedianCutGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  palette: number[][],
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (palette.length === 0 || palette.length > MAX_PALETTE) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "medianCut:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  // Flatten palette into vec3 array payload (pad unused slots with zeros).
  const flat = new Float32Array(MAX_PALETTE * 3);
  for (let i = 0; i < palette.length; i++) {
    flat[i * 3] = palette[i][0];
    flat[i * 3 + 1] = palette[i][1];
    flat[i * 3 + 2] = palette[i][2];
  }

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_count, palette.length);
    const loc = cache.prog.uniforms["u_palette[0]"];
    if (loc) gl.uniform3fv(loc, flat);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
