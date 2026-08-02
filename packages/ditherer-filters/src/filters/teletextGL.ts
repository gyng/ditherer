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
} from "../gl/index";

// Two-pass teletext. Pass A downsamples the source to (2*columns × rows)
// where each cell contributes one fg colour and one bg colour (the 2
// horizontally-adjacent texels). Pass B renders the full-resolution
// output by sampling the cell's fg/bg from pass A, evaluating the
// local 2×3 sub-block's luma against the threshold, and drawing a
// gap-darkened bg-ish pixel along the far edge of each sub-block. Fixed sample
// grids keep this valid for arbitrarily large source cells without a silent
// passthrough above a shader-loop dimension cap.
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

  for (int py = 0; py < 8; py++) {
    float y = cellY + (float(py) + 0.5) * u_cellH / 8.0;
    if (y >= u_srcRes.y) break;
    for (int pxi = 0; pxi < 8; pxi++) {
      float x = cellX + (float(pxi) + 0.5) * u_cellW / 8.0;
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
uniform float u_bitErrorRate;
uniform float u_burstErrors;
uniform int   u_concealment;
uniform float u_seed;

float hash(vec2 p) {
  return fract(sin(dot(p + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
}

// Packet address bytes are Hamming 8/4 protected. One bad bit is corrected;
// two or more make the address uncorrectable. Normal payload bytes use odd
// parity, which detects every odd number of bad bits.
bool addressUncorrectable(float row) {
  float p = clamp(u_bitErrorRate, 0.0, 0.5);
  float byteOk = pow(1.0 - p, 8.0) + 8.0 * p * pow(1.0 - p, 7.0);
  return hash(vec2(row, 91.0)) < 1.0 - byteOk * byteOk;
}
float payloadRoll(float column, float row, float salt) {
  float independent = hash(vec2(column + salt, row * 17.0 + 23.0 + salt));
  float burst = hash(vec2(floor(column / 5.0) + salt, row * 3.0 + 47.0));
  bool useBurst = hash(vec2(column * 0.37 + 11.0 + salt, row + 79.0))
    < clamp(u_burstErrors, 0.0, 1.0);
  return useBurst ? burst : independent;
}
float payloadFaultRoll(float column, float row) {
  return payloadRoll(column, row, 0.0);
}
bool payloadParityFailure(float column, float row, float roll) {
  float p = clamp(u_bitErrorRate, 0.0, 0.5);
  float oddProbability = (1.0 - pow(1.0 - 2.0 * p, 8.0)) * 0.5;
  return roll < oddProbability;
}
bool payloadUndetectedCorruption(float column, float row, float roll) {
  float p = clamp(u_bitErrorRate, 0.0, 0.5);
  float oddProbability = (1.0 - pow(1.0 - 2.0 * p, 8.0)) * 0.5;
  float evenProbability = (1.0 + pow(1.0 - 2.0 * p, 8.0)) * 0.5
    - pow(1.0 - p, 8.0);
  return roll >= oddProbability && roll < oddProbability + evenProbability;
}

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
  bool badAddress = addressUncorrectable(float(cy));
  float faultRoll = payloadFaultRoll(float(cx), float(cy));
  bool badPayload = payloadParityFailure(float(cx), float(cy), faultRoll);
  bool undetectedPayload = payloadUndetectedCorruption(float(cx), float(cy), faultRoll);
  bool badData = badAddress || badPayload;
  bool repeatPrevious = badData && u_concealment == 1 && cy > 0;
  if (repeatPrevious) {
    mapY = int(u_cellMapRes.y - 1.0) - (cy - 1);
  }
  vec3 fg = texelFetch(u_cellMap, ivec2(fgSlotX, mapY), 0).rgb * 255.0;
  vec3 bg = texelFetch(u_cellMap, ivec2(bgSlotX, mapY), 0).rgb * 255.0;

  int bx = int(floor((jsX - cellX) / u_blockW));
  int by = int(floor((jsY - cellY) / u_blockH));
  if (bx > 1) bx = 1;
  if (by > 2) by = 2;
  float subX = cellX + float(bx) * u_blockW;
  float sampleCellY = repeatPrevious ? float(cy - 1) * u_cellH : cellY;
  float subY = sampleCellY + float(by) * u_blockH;
  float displaySubY = cellY + float(by) * u_blockH;

  float subSum = 0.0;
  float subCount = 0.0;
  for (int iy = 0; iy < 4; iy++) {
    float py = subY + (float(iy) + 0.5) * u_blockH / 4.0;
    if (py >= u_srcRes.y) break;
    for (int ix = 0; ix < 4; ix++) {
      float px2 = subX + (float(ix) + 0.5) * u_blockW / 4.0;
      if (px2 >= u_srcRes.x) break;
      vec3 c = texture(u_source, vec2((px2 + 0.5) / u_srcRes.x, 1.0 - (py + 0.5) / u_srcRes.y)).rgb * 255.0;
      subSum += c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      subCount += 1.0;
    }
  }
  float avgLum = subCount > 0.0 ? subSum / subCount : 0.0;
  bool isOn = avgLum > u_threshold;
  if (badData && (u_concealment == 0 || (u_concealment == 1 && cy == 0))) isOn = false;
  if (badData && u_concealment == 2) {
    isOn = hash(vec2(float(cx * 7 + bx), float(cy * 11 + by))) > 0.5;
  }
  if (undetectedPayload && !badAddress) {
    isOn = hash(vec2(float(cx * 13 + bx), float(cy * 19 + by) + 211.0)) > 0.5;
  }
  vec3 col = isOn ? fg : bg;

  float localX = jsX - subX;
  // Concealment may source the mosaic pattern from the prior row, but the
  // separator geometry always belongs to the row currently being drawn.
  float localY = jsY - displaySubY;
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
      "u_source",
      "u_srcRes",
      "u_cellRes",
      "u_cellW",
      "u_cellH",
      "u_threshold",
    ] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_source",
      "u_cellMap",
      "u_srcRes",
      "u_cellMapRes",
      "u_cellW",
      "u_cellH",
      "u_blockW",
      "u_blockH",
      "u_blockGap",
      "u_threshold",
      "u_columns",
      "u_rows",
      "u_bitErrorRate",
      "u_burstErrors",
      "u_concealment",
      "u_seed",
    ] as const),
  };
  return _cache;
};

export const teletextGLAvailable = (): boolean => glAvailable();

export const renderTeletextGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  columns: number,
  threshold: number,
  blockGap: number,
  cellW: number,
  cellH: number,
  rows: number,
  blockW: number,
  blockH: number,
  bitErrorRate: number,
  burstErrors: number,
  concealment: number,
  seed: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const sourceTex = ensureTexture(gl, "teletext:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const cellMap = ensureTexture(gl, "teletext:cellMap", columns * 2, rows);
  drawPass(
    gl,
    cellMap,
    columns * 2,
    rows,
    cache.cell,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.cell.uniforms.u_source, 0);
      gl.uniform2f(cache.cell.uniforms.u_srcRes, width, height);
      gl.uniform2f(cache.cell.uniforms.u_cellRes, columns * 2, rows);
      gl.uniform1f(cache.cell.uniforms.u_cellW, cellW);
      gl.uniform1f(cache.cell.uniforms.u_cellH, cellH);
      gl.uniform1f(cache.cell.uniforms.u_threshold, threshold);
    },
    vao,
  );

  resizeGLCanvas(canvas, width, height);
  drawPass(
    gl,
    null,
    width,
    height,
    cache.render,
    () => {
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
      gl.uniform1f(cache.render.uniforms.u_bitErrorRate, bitErrorRate);
      gl.uniform1f(cache.render.uniforms.u_burstErrors, burstErrors);
      gl.uniform1i(cache.render.uniforms.u_concealment, concealment);
      gl.uniform1f(cache.render.uniforms.u_seed, seed);
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
