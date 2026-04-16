import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Woodcut binarisation + carved line texture. Sobel edges are computed
// in-shader from luma on a 3×3 neighbourhood so the whole filter is a
// single pass. Edge direction drives a perpendicular line-projection
// test; dark areas additionally get a diagonal hatching fill.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;   // 0..255
uniform float u_lineWeight;
uniform float u_edgeStrength;
uniform vec3  u_inkColor;    // 0..255
uniform vec3  u_paperColor;  // 0..255

float lumaAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  vec3 c = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb;
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float l = lumaAt(jsX, jsY) * 255.0;

  // Sobel 3x3 on luma (0..1 scale then scale to 0..255 to match JS).
  float l00 = lumaAt(jsX - 1.0, jsY - 1.0);
  float l10 = lumaAt(jsX,       jsY - 1.0);
  float l20 = lumaAt(jsX + 1.0, jsY - 1.0);
  float l01 = lumaAt(jsX - 1.0, jsY);
  float l21 = lumaAt(jsX + 1.0, jsY);
  float l02 = lumaAt(jsX - 1.0, jsY + 1.0);
  float l12 = lumaAt(jsX,       jsY + 1.0);
  float l22 = lumaAt(jsX + 1.0, jsY + 1.0);
  float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
  float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
  float mag = sqrt(gx * gx + gy * gy) * 255.0 * u_edgeStrength;
  float dir = atan(gy, gx);

  bool isInk = l < u_threshold;

  if (mag > 30.0) {
    float perpX = cos(dir + 1.57079632679);
    float perpY = sin(dir + 1.57079632679);
    float proj = jsX * perpX + jsY * perpY;
    float raw = mod(proj, u_lineWeight);
    float linePos = mod(raw + u_lineWeight, u_lineWeight);
    if (linePos < u_lineWeight * 0.5) isInk = true;
  }

  if (!isInk && l < u_threshold * 1.5) {
    float density = (u_threshold * 1.5 - l) / (u_threshold * 0.5);
    float lineFreq = u_lineWeight + 2.0;
    float linePos = mod(jsX + jsY, lineFreq);
    if (linePos < lineFreq * density * 0.3) isInk = true;
  }

  vec3 rgb = isInk ? u_inkColor : u_paperColor;
  fragColor = vec4(rgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_threshold", "u_lineWeight", "u_edgeStrength",
    "u_inkColor", "u_paperColor",
  ] as const) };
  return _cache;
};

export const woodcutGLAvailable = (): boolean => glAvailable();

export const renderWoodcutGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  threshold: number, lineWeight: number, edgeStrength: number,
  inkColor: [number, number, number], paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "woodcut:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_threshold, threshold);
    gl.uniform1f(cache.prog.uniforms.u_lineWeight, lineWeight);
    gl.uniform1f(cache.prog.uniforms.u_edgeStrength, edgeStrength);
    gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
