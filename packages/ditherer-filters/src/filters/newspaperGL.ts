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

// Aged newsprint look: locally averaged tone controls circular dot area on a
// rotatable screen, with fixed per-cell displacement and an optional fold.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dotSize;
uniform float u_screenAngle;
uniform float u_yellowing;
uniform float u_foldCrease;
uniform float u_inkSmear;

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

vec2 rotatePoint(vec2 point, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c) * point;
}

float sampleCellLuma(vec2 gridCentre, float angle) {
  float total = 0.0;
  for (int sy = -1; sy <= 1; sy++) {
    for (int sx = -1; sx <= 1; sx++) {
      vec2 gridSample = gridCentre + vec2(float(sx), float(sy)) * u_dotSize / 3.0;
      vec2 sourceSample = rotatePoint(gridSample, -angle) + u_res * 0.5;
      total += sampleLuma(sourceSample.x, sourceSample.y);
    }
  }
  return total / 9.0;
}

void main() {
  vec2 ppx = v_uv * u_res;
  float jsX = floor(ppx.x);
  float jsY = u_res.y - 1.0 - floor(ppx.y);
  float angle = radians(u_screenAngle);
  vec2 gridPoint = rotatePoint(vec2(jsX, jsY) - u_res * 0.5, angle);

  vec3 paper = vec3(
    floor(240.0 - u_yellowing * 20.0 + 0.5),
    floor(235.0 - u_yellowing * 30.0 + 0.5),
    floor(220.0 - u_yellowing * 60.0 + 0.5)
  );
  vec3 outRgb = paper;

  // Check 9 candidate cells: the containing cell and its 8 neighbours.
  float own_cx = floor(gridPoint.x / u_dotSize) * u_dotSize;
  float own_cy = floor(gridPoint.y / u_dotSize) * u_dotSize;
  for (int iy = -1; iy <= 1; iy++) {
    for (int ix = -1; ix <= 1; ix++) {
      float cx = own_cx + float(ix) * u_dotSize;
      float cy = own_cy + float(iy) * u_dotSize;
      vec2 gridCentre = vec2(cx, cy) + u_dotSize * 0.5;
      float lum = sampleCellLuma(gridCentre, angle);
      float darkness = 1.0 - lum;
      float dotR = (u_dotSize * 0.5) * sqrt(max(0.0, darkness));
      if (dotR < 0.3) continue;

      int seed1 = int(cx) * 31 + int(cy) * 997 + 42;
      int seed2 = int(cx) * 101 + int(cy) * 211 + 1337;
      float r1 = mulberryFirst(seed1);
      float r2 = mulberryFirst(seed2);
      float smearX = u_inkSmear > 0.0 ? (r1 - 0.5) * u_inkSmear * 3.0 : 0.0;
      float smearY = u_inkSmear > 0.0 ? (r2 - 0.5) * u_inkSmear * 3.0 : 0.0;
      float centreX = gridCentre.x + smearX;
      float centreY = gridCentre.y + smearY;

      float dx = gridPoint.x - centreX;
      float dy = gridPoint.y - centreY;
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
  fragColor = vec4(outRgb / 255.0, texture(u_source, v_uv).a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source",
      "u_res",
      "u_dotSize",
      "u_screenAngle",
      "u_yellowing",
      "u_foldCrease",
      "u_inkSmear",
    ] as const),
  };
  return _cache;
};

export const newspaperGLAvailable = (): boolean => glAvailable();

export const renderNewspaperGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  dotSize: number,
  screenAngle: number,
  yellowing: number,
  foldCrease: number,
  inkSmear: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "newspaper:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(
    gl,
    null,
    width,
    height,
    cache.prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.prog.uniforms.u_source, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
      gl.uniform1f(cache.prog.uniforms.u_screenAngle, screenAngle);
      gl.uniform1f(cache.prog.uniforms.u_yellowing, yellowing);
      gl.uniform1f(cache.prog.uniforms.u_foldCrease, foldCrease);
      gl.uniform1f(cache.prog.uniforms.u_inkSmear, inkSmear);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
