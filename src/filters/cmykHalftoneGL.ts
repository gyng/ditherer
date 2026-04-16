import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Four-channel CMYK halftone: rotate pixel coords per screen, snap to
// the nearest dot centre on that rotated grid, and if this fragment
// falls inside the dot at its local ink level, subtract from the RGB
// accumulator. All four screens (C, M, Y, K) run in one pass.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dotSize;
uniform float u_angleC;   // radians
uniform float u_angleM;
uniform float u_angleY;
uniform float u_angleK;
uniform vec3  u_paperColor; // 0..255

void applyScreen(inout vec3 acc, float value, float angle, float jsX, float jsY, int channel) {
  float c = cos(angle);
  float s = sin(angle);
  float rx = jsX * c + jsY * s;
  float ry = -jsX * s + jsY * c;
  float cx = (floor(rx / u_dotSize + 0.5) + 0.5) * u_dotSize;
  float cy = (floor(ry / u_dotSize + 0.5) + 0.5) * u_dotSize;
  float dx = rx - cx;
  float dy = ry - cy;
  float dist = sqrt(dx * dx + dy * dy);
  float maxR = u_dotSize * 0.7;
  float dotR = maxR * sqrt(max(0.0, value));
  if (dist < dotR) {
    float intensity = min(1.0, (dotR - dist) / 1.5 + 0.5);
    float f = 1.0 - intensity;
    if (channel == 0)      acc.r *= f;
    else if (channel == 1) acc.g *= f;
    else if (channel == 2) acc.b *= f;
    else                   acc *= f;
  }
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb;
  float k = 1.0 - max(src.r, max(src.g, src.b));
  float cVal = k < 1.0 ? (1.0 - src.r - k) / (1.0 - k) : 0.0;
  float mVal = k < 1.0 ? (1.0 - src.g - k) / (1.0 - k) : 0.0;
  float yVal = k < 1.0 ? (1.0 - src.b - k) / (1.0 - k) : 0.0;

  vec3 acc = u_paperColor / 255.0;
  applyScreen(acc, cVal, u_angleC, jsX, jsY, 0);
  applyScreen(acc, mVal, u_angleM, jsX, jsY, 1);
  applyScreen(acc, yVal, u_angleY, jsX, jsY, 2);
  applyScreen(acc, k,    u_angleK, jsX, jsY, 3);

  vec3 outRgb = floor(clamp(acc, 0.0, 1.0) * 255.0 + 0.5);
  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_dotSize",
    "u_angleC", "u_angleM", "u_angleY", "u_angleK",
    "u_paperColor",
  ] as const) };
  return _cache;
};

export const cmykHalftoneGLAvailable = (): boolean => glAvailable();

export const renderCmykHalftoneGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  dotSize: number,
  angleC: number, angleM: number, angleY: number, angleK: number,
  paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "cmykHalftone:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
    gl.uniform1f(cache.prog.uniforms.u_angleC, (angleC * Math.PI) / 180);
    gl.uniform1f(cache.prog.uniforms.u_angleM, (angleM * Math.PI) / 180);
    gl.uniform1f(cache.prog.uniforms.u_angleY, (angleY * Math.PI) / 180);
    gl.uniform1f(cache.prog.uniforms.u_angleK, (angleK * Math.PI) / 180);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
