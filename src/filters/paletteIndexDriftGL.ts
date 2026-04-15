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

// Palette-index-drift apply pass. The indexed palette and drift LUT are built
// on the CPU each frame (iterating pixels, histogram sort, mutable LUT state
// across frames — none of which map well to GL). The hot loop — nearest-index
// search + LUT remap + optional luma lock — runs in a fragment shader.
export const MAX_PALETTE = 96;

const DRIFT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_paletteCount;
uniform vec3  u_palette[${MAX_PALETTE}];      // 0..255
uniform int   u_driftMap[${MAX_PALETTE}];     // driftMap[idx] = drifted index
uniform int   u_lockLuma;                     // 0 or 1
uniform int   u_dither;                       // 0 or 1 — pre-index jitter
uniform float u_ditherSeed;                   // per-frame seed for the hash

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

float luma(vec3 c255) {
  return 0.2126 * c255.r + 0.7152 * c255.g + 0.0722 * c255.b;
}

void main() {
  vec2 px = v_uv * u_res;
  vec4 src = texture(u_source, v_uv);
  vec3 s255 = src.rgb * 255.0;

  vec3 q = s255;
  if (u_dither == 1) {
    // Same ±7 range as the JS reference (14 * (rng()-0.5)).
    float n = (hash(floor(px), u_ditherSeed) - 0.5) * 14.0;
    q = clamp(q + vec3(n), 0.0, 255.0);
  }

  // Nearest palette index by squared Euclidean RGB distance.
  int bestIdx = 0;
  float bestD = 1e30;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= u_paletteCount) break;
    vec3 dv = q - u_palette[i];
    float d = dot(dv, dv);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }

  int drifted = u_driftMap[bestIdx];
  vec3 outRgb = u_palette[drifted];

  if (u_lockLuma == 1) {
    float srcLum = luma(s255);
    float dstLum = max(1.0, luma(outRgb));
    float s = srcLum / dstLum;
    outRgb = clamp(outRgb * s, 0.0, 255.0);
  }

  fragColor = vec4(outRgb / 255.0, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, DRIFT_FS, [
      "u_source", "u_res", "u_paletteCount",
      "u_palette[0]", "u_driftMap[0]",
      "u_lockLuma", "u_dither", "u_ditherSeed",
    ] as const),
  };
  return _cache;
};

export const paletteIndexDriftGLAvailable = (): boolean => glAvailable();

export const renderPaletteIndexDriftGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  palette: number[][],
  driftMap: number[],
  lockLuma: boolean,
  dither: boolean,
  ditherSeed: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (palette.length === 0 || palette.length > MAX_PALETTE) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const flatPal = new Float32Array(MAX_PALETTE * 3);
  for (let i = 0; i < palette.length; i++) {
    flatPal[i * 3] = palette[i][0];
    flatPal[i * 3 + 1] = palette[i][1];
    flatPal[i * 3 + 2] = palette[i][2];
  }
  const flatDrift = new Int32Array(MAX_PALETTE);
  for (let i = 0; i < driftMap.length; i++) flatDrift[i] = driftMap[i] ?? i;

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "paletteIndexDrift:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_paletteCount, palette.length);
    const locPal = cache.prog.uniforms["u_palette[0]"];
    if (locPal) gl.uniform3fv(locPal, flatPal);
    const locDrift = cache.prog.uniforms["u_driftMap[0]"];
    if (locDrift) gl.uniform1iv(locDrift, flatDrift);
    gl.uniform1i(cache.prog.uniforms.u_lockLuma, lockLuma ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_dither, dither ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_ditherSeed, ditherSeed);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
