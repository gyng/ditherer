import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Thermal receipt-paper look: low-res luminance sampling, binary dot
// dropout with a per-pixel mulberry32 roll, paper-curl fade near the top
// and bottom of the page. The JS reference uses a single advancing RNG;
// we use a deterministic per-pixel hash seeded by (x, y, frame) — the
// exact dot positions differ but the visual character matches.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_scale;
uniform float u_fadeGradient;
uniform float u_dotDensity;
uniform int   u_frame;

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

  float edgeDist = min(jsY, u_res.y - jsY) / u_res.y;
  float curlFade = u_fadeGradient > 0.0
    ? min(1.0, edgeDist / (u_fadeGradient * 0.1 + 0.05))
    : 1.0;

  float sx = floor(jsX / u_scale) * u_scale;
  float sy = floor(jsY / u_scale) * u_scale;
  vec3 src = texture(u_source, vec2((min(u_res.x - 1.0, sx) + 0.5) / u_res.x,
                                    1.0 - (min(u_res.y - 1.0, sy) + 0.5) / u_res.y)).rgb;
  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float darkness = (1.0 - lum) * u_dotDensity * curlFade;

  int seed = int(jsX) * 31 + int(jsY) * 997 + u_frame * 113 + 42;
  float roll = mulberryFirst(seed);
  bool printed = darkness > roll * 0.8;

  vec3 outRgb;
  if (printed) {
    float fade = 1.0 - u_fadeGradient * (1.0 - curlFade);
    outRgb = vec3(
      floor(30.0 + (1.0 - fade) * 40.0 + 0.5),
      floor(25.0 + (1.0 - fade) * 30.0 + 0.5),
      floor(35.0 + (1.0 - fade) * 20.0 + 0.5)
    );
  } else {
    outRgb = vec3(248.0, 245.0, 240.0);
  }
  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_scale", "u_fadeGradient", "u_dotDensity", "u_frame",
  ] as const) };
  return _cache;
};

export const thermalPrinterGLAvailable = (): boolean => glAvailable();

export const renderThermalPrinterGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  scale: number, fadeGradient: number, dotDensity: number, frame: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "thermalPrinter:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_scale, scale);
    gl.uniform1f(cache.prog.uniforms.u_fadeGradient, fadeGradient);
    gl.uniform1f(cache.prog.uniforms.u_dotDensity, dotDensity);
    gl.uniform1i(cache.prog.uniforms.u_frame, frame | 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
