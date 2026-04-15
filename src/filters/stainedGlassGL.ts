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

// Stained-glass Voronoi in three stages:
//
//   1. Pass A (GPU): for each pixel, search its 5×5 grid neighbourhood of
//      jittered seeds and emit (cellId_lo, cellId_hi, borderDist). Packed
//      into RGBA8 so we don't need EXT_color_buffer_float. `borderDist` is
//      (d₂ - d₁)/2 in pixels, clamped to 255 (far more than leadingWidth's
//      max of 6, so saturation is harmless for the leading test).
//   2. CPU readback: sum source RGB per cellId, divide → per-cell average
//      color lookup. Uploaded as a 1D RGBA8 texture. The readback is the
//      trade-off — reduces cleanly don't fit in a fragment shader without
//      compute/transform-feedback, so we round-trip for this step.
//   3. Pass B (GPU): per pixel, sample the pass-A texture to get its cell
//      id + border distance, look up the cell color, apply leading.
//
// Seeds are uploaded as an RGBA32F grid texture — sampling float textures
// is native in WebGL2, only *rendering* to them needs the extension.

// --- Pass A: per-pixel nearest + second-nearest seed search. ---
const VORONOI_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_seeds;     // RG = (x, y) per texel; grid (cols+1) × (rows+1)
uniform vec2  u_res;
uniform int   u_gridCols;      // cols + 1 (total seed columns)
uniform int   u_gridRows;      // rows + 1 (total seed rows)
uniform int   u_cellSize;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y so grid indexing matches the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  int gx = int(x) / u_cellSize;
  int gy = int(y) / u_cellSize;

  float minDist = 1e30;
  float minDist2 = 1e30;
  int minIdx = 0;

  for (int dgy = -2; dgy <= 2; dgy++) {
    for (int dgx = -2; dgx <= 2; dgx++) {
      int sx = gx + dgx + 1;
      int sy = gy + dgy + 1;
      if (sx < 0 || sx >= u_gridCols || sy < 0 || sy >= u_gridRows) continue;
      int cellId = sy * u_gridCols + sx;
      vec2 pos = texelFetch(u_seeds, ivec2(sx, sy), 0).rg;
      float ddx = x - pos.x;
      float ddy = y - pos.y;
      float d = ddx * ddx + ddy * ddy;
      if (d < minDist) {
        minDist2 = minDist;
        minDist = d;
        minIdx = cellId;
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }

  float d1 = sqrt(minDist);
  float d2 = sqrt(minDist2);
  float borderDist = clamp((d2 - d1) * 0.5, 0.0, 255.0);

  // Pack cellId into two bytes. Max encodable: 65535 cells (enough for any
  // practical cellSize ≥ ~4 on typical canvases).
  int lo = minIdx - (minIdx / 256) * 256;
  int hi = minIdx / 256;
  fragColor = vec4(float(lo) / 255.0, float(hi) / 255.0, borderDist / 255.0, 1.0);
}
`;

// --- Pass B: final composite. ---
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_voronoi;   // Pass A
uniform sampler2D u_cellColors; // 1D lookup
uniform int   u_cellCount;
uniform float u_leadingWidth;
uniform vec3  u_leadingColor;
uniform float u_levels;

void main() {
  vec4 v = texture(u_voronoi, v_uv);
  int lo = int(floor(v.r * 255.0 + 0.5));
  int hi = int(floor(v.g * 255.0 + 0.5));
  int cellId = hi * 256 + lo;
  float borderDist = v.b * 255.0;

  vec3 rgb;
  if (borderDist < u_leadingWidth) {
    rgb = u_leadingColor;
  } else {
    int idx = min(cellId, u_cellCount - 1);
    float u = (float(idx) + 0.5) / float(u_cellCount);
    rgb = texture(u_cellColors, vec2(u, 0.5)).rgb * 255.0;
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = {
  voronoi: Program;
  composite: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    voronoi: linkProgram(gl, VORONOI_FS, [
      "u_seeds", "u_res", "u_gridCols", "u_gridRows", "u_cellSize",
    ] as const),
    composite: linkProgram(gl, COMPOSITE_FS, [
      "u_voronoi", "u_cellColors", "u_cellCount",
      "u_leadingWidth", "u_leadingColor", "u_levels",
    ] as const),
  };
  return _cache;
};

export const stainedGlassGLAvailable = (): boolean => glAvailable();

const uploadSeeds = (
  gl: WebGL2RenderingContext,
  seeds: { x: number; y: number }[],
  gridCols: number,
  gridRows: number,
): WebGLTexture | null => {
  // RGBA32F: R = seed x, G = seed y. Sampling float textures is native in
  // WebGL2; only rendering to them needs EXT_color_buffer_float.
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const data = new Float32Array(gridCols * gridRows * 4);
  for (let i = 0; i < seeds.length && i < gridCols * gridRows; i++) {
    data[i * 4] = seeds[i].x;
    data[i * 4 + 1] = seeds[i].y;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gridCols, gridRows, 0, gl.RGBA, gl.FLOAT, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return tex;
};

const uploadCellColors = (
  gl: WebGL2RenderingContext,
  colors: Uint8Array,
  count: number,
): WebGLTexture | null => {
  if (count === 0) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, count, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colors);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return tex;
};

export const renderStainedGlassGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  seeds: { x: number; y: number }[],
  gridCols: number,
  gridRows: number,
  cellSize: number,
  leadingWidth: number,
  leadingColor: [number, number, number],
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const seedTex = uploadSeeds(gl, seeds, gridCols, gridRows);
  if (!seedTex) return null;

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "stainedGlass:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const voronoiTex = ensureTexture(gl, "stainedGlass:voronoi", width, height);

  drawPass(gl, voronoiTex, width, height, cache.voronoi, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, seedTex);
    gl.uniform1i(cache.voronoi.uniforms.u_seeds, 0);
    gl.uniform2f(cache.voronoi.uniforms.u_res, width, height);
    gl.uniform1i(cache.voronoi.uniforms.u_gridCols, gridCols);
    gl.uniform1i(cache.voronoi.uniforms.u_gridRows, gridRows);
    gl.uniform1i(cache.voronoi.uniforms.u_cellSize, cellSize);
  }, vao);

  // Readback Pass A → sum RGB per cellId on CPU → per-cell averages.
  // The readback is aligned to Pass A's FBO, which writes in GL-y orientation.
  const voronoiPixels = new Uint8Array(width * height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, voronoiTex.fbo);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, voronoiPixels);

  const cellCount = gridCols * gridRows;
  const sumR = new Float64Array(cellCount);
  const sumG = new Float64Array(cellCount);
  const sumB = new Float64Array(cellCount);
  const cnt = new Uint32Array(cellCount);
  for (let py = 0; py < height; py++) {
    // Source is uploaded with FLIP_Y, so source row `py` in JS corresponds to
    // pixel row `py`. Pass A rendered in GL-y, so Pass A pixel row `glY` holds
    // the voronoi for JS row `height - 1 - glY`.
    const voronoiY = height - 1 - py;
    const voronoiRow = voronoiY * width * 4;
    const sourceRow = py * width * 4;
    for (let px = 0; px < width; px++) {
      const vi = voronoiRow + px * 4;
      const si = sourceRow + px * 4;
      const cellId = (voronoiPixels[vi] ?? 0) + (voronoiPixels[vi + 1] ?? 0) * 256;
      if (cellId >= cellCount) continue;
      sumR[cellId] += sourcePixels[si] ?? 0;
      sumG[cellId] += sourcePixels[si + 1] ?? 0;
      sumB[cellId] += sourcePixels[si + 2] ?? 0;
      cnt[cellId]++;
    }
  }
  const cellColors = new Uint8Array(cellCount * 4);
  for (let i = 0; i < cellCount; i++) {
    const c = cnt[i];
    if (c > 0) {
      cellColors[i * 4] = Math.round(sumR[i] / c);
      cellColors[i * 4 + 1] = Math.round(sumG[i] / c);
      cellColors[i * 4 + 2] = Math.round(sumB[i] / c);
    } else {
      cellColors[i * 4] = 128; cellColors[i * 4 + 1] = 128; cellColors[i * 4 + 2] = 128;
    }
    cellColors[i * 4 + 3] = 255;
  }
  const cellTex = uploadCellColors(gl, cellColors, cellCount);
  if (!cellTex) {
    gl.deleteTexture(seedTex);
    return null;
  }

  drawPass(gl, null, width, height, cache.composite, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, voronoiTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_voronoi, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.uniform1i(cache.composite.uniforms.u_cellColors, 1);
    gl.uniform1i(cache.composite.uniforms.u_cellCount, cellCount);
    gl.uniform1f(cache.composite.uniforms.u_leadingWidth, leadingWidth);
    gl.uniform3f(cache.composite.uniforms.u_leadingColor,
      leadingColor[0], leadingColor[1], leadingColor[2]);
    gl.uniform1f(cache.composite.uniforms.u_levels, levels);
  }, vao);

  const out = readoutToCanvas(canvas, width, height);
  gl.deleteTexture(seedTex);
  gl.deleteTexture(cellTex);
  return out;
};
