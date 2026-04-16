import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Two-pass teletext. Pass A downsamples the source to (2*columns × rows)
// where each cell contributes one fg colour and one bg colour (the 2
// horizontally-adjacent texels). Pass B renders the full-resolution
// output by sampling the cell's fg/bg from pass A, evaluating the
// local 2×3 sub-block's luma against the threshold, and drawing a
// gap-darkened bg-ish pixel along the far edge of each sub-block.
// Max supported cell dimensions are 48×48 inside pass A (extreme
// configs fall back to JS).
const CELL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_srcRes;
uniform vec2  u_cellRes;    // 2*columns × rows — output size
uniform float u_cellW;
uniform float u_cellH;
uniform float u_threshold;

const vec3 TELETEXT_COLORS[8] = vec3[8](
  vec3(0.0,   0.0,   0.0),
  vec3(255.0, 0.0,   0.0),
  vec3(0.0,   255.0, 0.0),
  vec3(255.0, 255.0, 0.0),
  vec3(0.0,   0.0,   255.0),
  vec3(255.0, 0.0,   255.0),
  vec3(0.0,   255.0, 255.0),
  vec3(255.0, 255.0, 255.0)
);

vec3 nearestTeletext(vec3 col) {
  float best = 1e18;
  vec3 ret = TELETEXT_COLORS[0];
  for (int i = 0; i < 8; i++) {
    vec3 d = col - TELETEXT_COLORS[i];
    float dist = dot(d, d);
    if (dist < best) { best = dist; ret = TELETEXT_COLORS[i]; }
  }
  return ret;
}

void main() {
  vec2 px = v_uv * u_cellRes;
  int tx = int(floor(px.x));
  int ty = int(u_cellRes.y - 1.0 - floor(px.y));

  int cx = tx / 2;
  int slot = tx - cx * 2;
  int cy = ty;

  float cellX = float(cx) * u_cellW;
  float cellY = float(cy) * u_cellH;

  vec3 total = vec3(0.0);
  vec3 bright = vec3(0.0);
  vec3 dark = vec3(0.0);
  float brightCount = 0.0;
  float darkCount = 0.0;
  float total_n = 0.0;

  for (int py = 0; py < 48; py++) {
    if (float(py) >= u_cellH) break;
    float y = cellY + float(py);
    if (y >= u_srcRes.y) break;
    for (int pxi = 0; pxi < 48; pxi++) {
      if (float(pxi) >= u_cellW) break;
      float x = cellX + float(pxi);
      if (x >= u_srcRes.x) break;
      vec3 c = texture(u_source, vec2((x + 0.5) / u_srcRes.x, 1.0 - (y + 0.5) / u_srcRes.y)).rgb * 255.0;
      total += c;
      total_n += 1.0;
      float lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      if (lum > u_threshold) { bright += c; brightCount += 1.0; }
      else                   { dark   += c; darkCount   += 1.0; }
    }
  }

  vec3 fg, bg;
  if (brightCount > 0.0) fg = nearestTeletext(bright / brightCount);
  else                   fg = nearestTeletext(total / max(1.0, total_n));
  if (darkCount > 0.0)   bg = nearestTeletext(dark / darkCount);
  else                   bg = TELETEXT_COLORS[0];

  if (fg == bg) {
    bg = TELETEXT_COLORS[0];
    if (fg == TELETEXT_COLORS[0]) fg = TELETEXT_COLORS[7];
  }

  vec3 rgb = slot == 0 ? fg : bg;
  fragColor = vec4(rgb / 255.0, 1.0);
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_cellMap;
uniform vec2  u_srcRes;
uniform vec2  u_cellMapRes;
uniform float u_cellW;
uniform float u_cellH;
uniform float u_blockW;
uniform float u_blockH;
uniform float u_blockGap;
uniform float u_threshold;
uniform int   u_columns;
uniform int   u_rows;

void main() {
  vec2 px = v_uv * u_srcRes;
  float jsX = floor(px.x);
  float jsY = u_srcRes.y - 1.0 - floor(px.y);

  int cx = int(floor(jsX / u_cellW));
  int cy = int(floor(jsY / u_cellH));
  if (cx >= u_columns || cy >= u_rows) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float cellX = float(cx) * u_cellW;
  float cellY = float(cy) * u_cellH;

  int fgSlotX = cx * 2;
  int bgSlotX = cx * 2 + 1;
  int mapY = int(u_cellMapRes.y - 1.0) - cy;
  vec3 fg = texelFetch(u_cellMap, ivec2(fgSlotX, mapY), 0).rgb * 255.0;
  vec3 bg = texelFetch(u_cellMap, ivec2(bgSlotX, mapY), 0).rgb * 255.0;

  int bx = int(floor((jsX - cellX) / u_blockW));
  int by = int(floor((jsY - cellY) / u_blockH));
  if (bx > 1) bx = 1;
  if (by > 2) by = 2;
  float subX = cellX + float(bx) * u_blockW;
  float subY = cellY + float(by) * u_blockH;

  float subSum = 0.0;
  float subCount = 0.0;
  for (int iy = 0; iy < 48; iy++) {
    if (float(iy) >= u_blockH) break;
    float py = subY + float(iy);
    if (py >= u_srcRes.y) break;
    for (int ix = 0; ix < 48; ix++) {
      if (float(ix) >= u_blockW) break;
      float px2 = subX + float(ix);
      if (px2 >= u_srcRes.x) break;
      vec3 c = texture(u_source, vec2((px2 + 0.5) / u_srcRes.x, 1.0 - (py + 0.5) / u_srcRes.y)).rgb * 255.0;
      subSum += c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      subCount += 1.0;
    }
  }
  float avgLum = subCount > 0.0 ? subSum / subCount : 0.0;
  bool isOn = avgLum > u_threshold;
  vec3 col = isOn ? fg : bg;

  float localX = jsX - subX;
  float localY = jsY - subY;
  float gapX = min(u_blockGap, u_blockW - 1.0);
  float gapY = min(u_blockGap, u_blockH - 1.0);
  bool inGapX = gapX > 0.0 && localX >= u_blockW - gapX;
  bool inGapY = gapY > 0.0 && localY >= u_blockH - gapY;

  vec3 outRgb;
  if (inGapX || inGapY) outRgb = floor(bg * 0.3 + 0.5);
  else                  outRgb = col;
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { cell: Program; render: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cell: linkProgram(gl, CELL_FS, [
      "u_source", "u_srcRes", "u_cellRes", "u_cellW", "u_cellH", "u_threshold",
    ] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_source", "u_cellMap", "u_srcRes", "u_cellMapRes",
      "u_cellW", "u_cellH", "u_blockW", "u_blockH", "u_blockGap",
      "u_threshold", "u_columns", "u_rows",
    ] as const),
  };
  return _cache;
};

export const teletextGLAvailable = (): boolean => glAvailable();

export const renderTeletextGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  columns: number, threshold: number, blockGap: number,
  cellW: number, cellH: number, rows: number,
  blockW: number, blockH: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (cellW > 48 || cellH > 48) return null;    // exceeds shader static bounds
  if (blockW > 48 || blockH > 48) return null;

  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const sourceTex = ensureTexture(gl, "teletext:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const cellMap = ensureTexture(gl, "teletext:cellMap", columns * 2, rows);
  drawPass(gl, cellMap, columns * 2, rows, cache.cell, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.cell.uniforms.u_source, 0);
    gl.uniform2f(cache.cell.uniforms.u_srcRes, width, height);
    gl.uniform2f(cache.cell.uniforms.u_cellRes, columns * 2, rows);
    gl.uniform1f(cache.cell.uniforms.u_cellW, cellW);
    gl.uniform1f(cache.cell.uniforms.u_cellH, cellH);
    gl.uniform1f(cache.cell.uniforms.u_threshold, threshold);
  }, vao);

  resizeGLCanvas(canvas, width, height);
  drawPass(gl, null, width, height, cache.render, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.render.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cellMap.tex);
    gl.uniform1i(cache.render.uniforms.u_cellMap, 1);
    gl.uniform2f(cache.render.uniforms.u_srcRes, width, height);
    gl.uniform2f(cache.render.uniforms.u_cellMapRes, columns * 2, rows);
    gl.uniform1f(cache.render.uniforms.u_cellW, cellW);
    gl.uniform1f(cache.render.uniforms.u_cellH, cellH);
    gl.uniform1f(cache.render.uniforms.u_blockW, blockW);
    gl.uniform1f(cache.render.uniforms.u_blockH, blockH);
    gl.uniform1f(cache.render.uniforms.u_blockGap, blockGap);
    gl.uniform1f(cache.render.uniforms.u_threshold, threshold);
    gl.uniform1i(cache.render.uniforms.u_columns, columns);
    gl.uniform1i(cache.render.uniforms.u_rows, rows);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
