import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// The CPU path still owns all temporal state (lane positions, illumination
// sweeps, motion-triggered drops); GL only accelerates the final
// per-pixel glyph rasterisation. Per-cell character / flip / illumination
// data and lane info are uploaded as textures; the shader walks lanes and
// composites "brightest wins" in place of the CPU's final for-loop.
const MR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_atlas;     // charCount glyphs side by side, R channel alpha
uniform sampler2D u_laneInfo;  // laneCount × 1: (centerPx, widthPx, _, _)
uniform sampler2D u_cellData;  // laneCount × rows: (charIdx, transformMode, illum, glyphScale)
uniform vec2  u_res;
uniform float u_laneCount;
uniform float u_rows;
uniform float u_charH;
uniform float u_charCount;
uniform float u_bitmapCellSize;
uniform float u_sourceInfluence;
uniform int   u_classicGreen;

// Match the CPU code's flip-mode table, which is a 6-way pick of
// identity, mirror-x, mirror-y, rotate-180, rotate-90-cw, rotate-90-ccw.
vec2 applyTransform(vec2 src, float last, int mode) {
  vec2 t = src;
  if (mode == 1) t.x = last - src.x;
  else if (mode == 2) t.y = last - src.y;
  else if (mode == 3) { t.x = last - src.x; t.y = last - src.y; }
  else if (mode == 4) { t.x = src.y; t.y = last - src.x; }
  else if (mode == 5) { t.x = last - src.y; t.y = src.x; }
  return t;
}

float sampleAtlas(float charIdx, vec2 src) {
  float atlasW = u_charCount * u_bitmapCellSize;
  float atlasH = u_bitmapCellSize;
  float ax = charIdx * u_bitmapCellSize + src.x;
  float ay = src.y;
  // Atlas isn't flipped on upload (we build it with plain texImage2D),
  // so sample directly.
  vec2 uv = vec2((ax + 0.5) / atlasW, (ay + 0.5) / atlasH);
  return texture(u_atlas, uv).r;
}

vec4 laneAt(float lane) {
  return texture(u_laneInfo, vec2((lane + 0.5) / u_laneCount, 0.5));
}

vec4 cellAt(float lane, float row) {
  return texture(u_cellData, vec2((lane + 0.5) / u_laneCount, (row + 0.5) / u_rows));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float row = floor(y / u_charH);
  if (row < 0.0 || row >= u_rows) {
    fragColor = vec4(0.0, 2.0 / 255.0, 0.0, 1.0);
    return;
  }

  vec3 bgColor = vec3(0.0, 2.0 / 255.0, 0.0);
  vec3 bestColor = bgColor;
  float bestLumSum = bgColor.r * 255.0 + bgColor.g * 255.0 + bgColor.b * 255.0;

  vec3 srcRGB = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  float srcLum = 0.2126 * srcRGB.r + 0.7152 * srcRGB.g + 0.0722 * srcRGB.b;
  float effectiveLum = srcLum * u_sourceInfluence + (1.0 - u_sourceInfluence);

  int laneN = int(u_laneCount);
  for (int lane = 0; lane < 512; lane++) {
    if (lane >= laneN) break;
    vec4 li = laneAt(float(lane));
    float centerPx = li.r;
    float baseWidth = li.g;

    vec4 cd = cellAt(float(lane), row);
    float charIdx = cd.r;
    float transformMode = cd.g;
    float illum = cd.b;
    float glyphScale = cd.a;
    if (illum < 0.01) continue;

    float glyphW = max(2.0, floor(baseWidth * glyphScale + 0.5));
    float glyphH = max(2.0, floor(u_charH * glyphScale + 0.5));
    float cellX = floor(centerPx - glyphW * 0.5 + 0.5);
    float glyphY = floor(row * u_charH + (u_charH - glyphH) * 0.5 + 0.5);

    if (x < cellX || x >= cellX + glyphW) continue;
    if (y < glyphY || y >= glyphY + glyphH) continue;

    float dx = x - cellX;
    float dy = y - glyphY;
    float srcX = min(u_bitmapCellSize - 1.0, floor(dx / glyphW * u_bitmapCellSize));
    float srcY = min(u_bitmapCellSize - 1.0, floor(dy / glyphH * u_bitmapCellSize));
    vec2 tsrc = applyTransform(vec2(srcX, srcY), u_bitmapCellSize - 1.0, int(transformMode));
    float alpha = sampleAtlas(charIdx, tsrc);
    if (alpha < 0.05) continue;

    float brightness = min(1.0, effectiveLum * min(illum, 1.0) * alpha);
    if (brightness < 0.01) continue;

    bool isHead = illum > 1.2;
    bool isNearHead = illum > 0.9 && !isHead;

    vec3 c;
    if (u_classicGreen == 1) {
      if (isHead) {
        float v = floor(brightness * 255.0 + 0.5);
        c = vec3(floor(v * 0.70 + 0.5), v, floor(v * 0.46 + 0.5));
      } else if (isNearHead) {
        float v = floor(brightness * 230.0 + 0.5);
        c = vec3(floor(v * 0.05 + 0.5), v, floor(v * 0.05 + 0.5));
      } else {
        float v = floor(brightness * 180.0 + 0.5);
        c = vec3(floor(v * 0.05 + 0.5), v, floor(v * 0.05 + 0.5));
      }
    } else {
      float srcR = srcRGB.r * 255.0;
      float srcG = srcRGB.g * 255.0;
      float srcB = srcRGB.b * 255.0;
      float mx = max(max(srcR, srcG), srcB);
      float scale = brightness * 230.0 / max(1.0, mx);
      c = vec3(floor(srcR * scale + 0.5), floor(srcG * scale + 0.5), floor(srcB * scale + 0.5));
      if (isHead) {
        float headLum = floor(brightness * 230.0 + 0.5);
        c = floor(c * 0.3 + vec3(headLum) * 0.7 + 0.5);
      }
    }

    c = clamp(c, vec3(0.0), vec3(255.0));
    if (c.r < 3.0 && c.g < 3.0 && c.b < 3.0) continue;
    float newLum = c.r + c.g + c.b;
    if (newLum > bestLumSum) {
      bestLumSum = newLum;
      bestColor = c / 255.0;
    }
  }

  fragColor = vec4(bestColor, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, MR_FS, [
      "u_source", "u_atlas", "u_laneInfo", "u_cellData", "u_res",
      "u_laneCount", "u_rows", "u_charH", "u_charCount",
      "u_bitmapCellSize", "u_sourceInfluence", "u_classicGreen",
    ] as const),
  };
  return _cache;
};

const uploadAtlas = (gl: WebGL2RenderingContext, bitmaps: Uint8Array[], cellSize: number) => {
  const charCount = bitmaps.length;
  const w = charCount * cellSize;
  const h = cellSize;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < charCount; i++) {
    const bm = bitmaps[i];
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        data[y * w + (i * cellSize + x)] = bm[y * cellSize + x];
      }
    }
  }
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const prev = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prev);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
};

const uploadRGBA32F = (
  gl: WebGL2RenderingContext,
  unit: number,
  data: Float32Array,
  width: number,
  height: number,
) => {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const prev = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prev);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
};

export const matrixRainGLAvailable = (): boolean => glAvailable();

export type MatrixRainGLParams = {
  charBitmaps: Uint8Array[];
  bitmapCellSize: number;
  laneCount: number;
  rows: number;
  charH: number;
  laneInfo: Float32Array;      // laneCount × 4: centerPx, widthPx, _, _
  cellData: Float32Array;      // laneCount × rows × 4: charIdx, flipMode, illum, glyphScale
  sourceInfluence: number;
  classicGreen: boolean;
};

export const renderMatrixRainGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  params: MatrixRainGLParams,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "matrixRain:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const atlasTex = uploadAtlas(gl, params.charBitmaps, params.bitmapCellSize);
  const laneTex = uploadRGBA32F(gl, 2, params.laneInfo, params.laneCount, 1);
  const cellTex = uploadRGBA32F(gl, 3, params.cellData, params.laneCount, params.rows);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(cache.prog.uniforms.u_atlas, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, laneTex);
    gl.uniform1i(cache.prog.uniforms.u_laneInfo, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.uniform1i(cache.prog.uniforms.u_cellData, 3);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_laneCount, params.laneCount);
    gl.uniform1f(cache.prog.uniforms.u_rows, params.rows);
    gl.uniform1f(cache.prog.uniforms.u_charH, params.charH);
    gl.uniform1f(cache.prog.uniforms.u_charCount, params.charBitmaps.length);
    gl.uniform1f(cache.prog.uniforms.u_bitmapCellSize, params.bitmapCellSize);
    gl.uniform1f(cache.prog.uniforms.u_sourceInfluence, params.sourceInfluence);
    gl.uniform1i(cache.prog.uniforms.u_classicGreen, params.classicGreen ? 1 : 0);
  }, vao);

  const result = readoutToCanvas(canvas, width, height);
  gl.deleteTexture(atlasTex);
  gl.deleteTexture(laneTex);
  gl.deleteTexture(cellTex);
  return result;
};
