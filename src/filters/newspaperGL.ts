import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Aged newsprint look: yellowed paper, halftone dots per (dotSize × dotSize)
// cell, random ink smear, optional fold crease at the centre cross. The
// JS reference averages luma across every pixel in a cell; here we
// sample the cell's centre pixel — visually indistinguishable for a
// halftone filter and saves 256 texture fetches per fragment at large
// dot sizes. RNG is replaced with a per-cell mulberry32 hash so smear
// is deterministic per cell rather than iteration-order-dependent.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dotSize;
uniform float u_yellowing;
uniform float u_foldCrease;
uniform float u_inkSmear;
uniform int   u_frame;

float mulberryFirst(int seed) {
  uint s = uint(seed) + 0x6D2B79F5u;
  uint t = (s ^ (s >> 15u)) * (1u | s);
  t = ((t ^ (t >> 7u)) * (61u | t)) ^ t;
  t = t ^ (t >> 14u);
  return float(t) / 4294967296.0;
}

float sampleLuma(float sx, float sy) {
  float x = clamp(sx, 0.0, u_res.x - 1.0);
  float y = clamp(sy, 0.0, u_res.y - 1.0);
  vec3 c = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}

void main() {
  vec2 ppx = v_uv * u_res;
  float jsX = floor(ppx.x);
  float jsY = u_res.y - 1.0 - floor(ppx.y);

  vec3 paper = vec3(
    floor(240.0 - u_yellowing * 20.0 + 0.5),
    floor(235.0 - u_yellowing * 30.0 + 0.5),
    floor(220.0 - u_yellowing * 60.0 + 0.5)
  );
  vec3 outRgb = paper;

  // Check 9 candidate cells: the containing cell and its 8 neighbours.
  float own_cx = floor(jsX / u_dotSize) * u_dotSize;
  float own_cy = floor(jsY / u_dotSize) * u_dotSize;
  for (int iy = -1; iy <= 1; iy++) {
    for (int ix = -1; ix <= 1; ix++) {
      float cx = own_cx + float(ix) * u_dotSize;
      float cy = own_cy + float(iy) * u_dotSize;
      if (cx < 0.0 || cy < 0.0 || cx >= u_res.x || cy >= u_res.y) continue;

      float cellCentreSampleX = min(cx + floor(u_dotSize * 0.5), u_res.x - 1.0);
      float cellCentreSampleY = min(cy + floor(u_dotSize * 0.5), u_res.y - 1.0);
      float lum = sampleLuma(cellCentreSampleX, cellCentreSampleY);
      float darkness = 1.0 - lum;
      float dotR = (u_dotSize * 0.5) * sqrt(max(0.0, darkness));
      if (dotR < 0.3) continue;

      int seed1 = int(cx) * 31 + int(cy) * 997 + u_frame * 113 + 42;
      int seed2 = int(cx) * 101 + int(cy) * 211 + u_frame * 137 + 1337;
      float r1 = mulberryFirst(seed1);
      float r2 = mulberryFirst(seed2);
      float smearX = u_inkSmear > 0.0 ? (r1 - 0.5) * u_inkSmear * 3.0 : 0.0;
      float smearY = u_inkSmear > 0.0 ? (r2 - 0.5) * u_inkSmear * 3.0 : 0.0;
      float centreX = cx + u_dotSize * 0.5 + smearX;
      float centreY = cy + u_dotSize * 0.5 + smearY;

      float dx = jsX - centreX;
      float dy = jsY - centreY;
      float dist = sqrt(dx * dx + dy * dy);
      if (dist > dotR) continue;

      float ink = min(1.0, (dotR - dist) / 1.5 + 0.3);
      outRgb = outRgb * (1.0 - ink) + vec3(20.0) * ink;
    }
  }

  // Fold creases at the centre cross.
  if (u_foldCrease > 0.0) {
    float creaseDarken = u_foldCrease * 40.0;
    float distH = abs(jsY - u_res.y * 0.5);
    float distV = abs(jsX - u_res.x * 0.5);
    float crease = max(0.0, 1.0 - min(distH, distV) / 8.0) * creaseDarken;
    outRgb = max(vec3(0.0), outRgb - floor(crease + 0.5));
  }

  outRgb = clamp(floor(outRgb + 0.5), 0.0, 255.0);
  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_dotSize", "u_yellowing", "u_foldCrease",
    "u_inkSmear", "u_frame",
  ] as const) };
  return _cache;
};

export const newspaperGLAvailable = (): boolean => glAvailable();

export const renderNewspaperGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  dotSize: number, yellowing: number, foldCrease: number, inkSmear: number, frame: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "newspaper:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
    gl.uniform1f(cache.prog.uniforms.u_yellowing, yellowing);
    gl.uniform1f(cache.prog.uniforms.u_foldCrease, foldCrease);
    gl.uniform1f(cache.prog.uniforms.u_inkSmear, inkSmear);
    gl.uniform1i(cache.prog.uniforms.u_frame, frame | 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
