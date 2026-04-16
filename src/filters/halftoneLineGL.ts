import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Line halftone: for each output pixel, resolve which grid cell it
// belongs to, compute cell darkness (centre-sample approximation in
// place of the JS reference's per-cell average — visually
// indistinguishable for a halftone) and optionally a Sobel direction,
// then test whether the pixel lies on the cell's darkness-driven line
// segment.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_cellSize;
uniform int   u_angleMode;   // 0 = constant, 1 = luminance, 2 = gradient
uniform float u_baseAngle;   // radians
uniform vec3  u_inkColor;    // 0..255
uniform vec3  u_paperColor;  // 0..255

float lumaAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  vec3 c = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb;
  return (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722) * 255.0;
}

float sobelDirAt(float jsX, float jsY) {
  float l00 = lumaAt(jsX - 1.0, jsY - 1.0) / 255.0;
  float l10 = lumaAt(jsX,       jsY - 1.0) / 255.0;
  float l20 = lumaAt(jsX + 1.0, jsY - 1.0) / 255.0;
  float l01 = lumaAt(jsX - 1.0, jsY) / 255.0;
  float l21 = lumaAt(jsX + 1.0, jsY) / 255.0;
  float l02 = lumaAt(jsX - 1.0, jsY + 1.0) / 255.0;
  float l12 = lumaAt(jsX,       jsY + 1.0) / 255.0;
  float l22 = lumaAt(jsX + 1.0, jsY + 1.0) / 255.0;
  float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
  float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
  return atan(gy, gx);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float cellX = floor(jsX / u_cellSize) * u_cellSize;
  float cellY = floor(jsY / u_cellSize) * u_cellSize;
  float centreX = min(u_res.x - 1.0, cellX + u_cellSize * 0.5);
  float centreY = min(u_res.y - 1.0, cellY + u_cellSize * 0.5);

  float avgLum = lumaAt(centreX, centreY);

  float angle = u_baseAngle;
  if (u_angleMode == 1) {
    angle += (avgLum / 255.0) * 1.57079632679;
  } else if (u_angleMode == 2) {
    angle = sobelDirAt(centreX, centreY) + 1.57079632679;
  }

  float darkness = 1.0 - avgLum / 255.0;
  float halfLen = max(1.0, darkness * u_cellSize * 0.45);
  float thickness = max(0.5, darkness * 2.25);

  float cosA = cos(angle);
  float sinA = sin(angle);
  float dx = jsX - centreX;
  float dy = jsY - centreY;
  float along = dx * cosA + dy * sinA;
  float across = -dx * sinA + dy * cosA;

  bool onLine = abs(along) <= halfLen && abs(across) <= thickness;
  vec3 rgb = onLine ? u_inkColor : u_paperColor;
  fragColor = vec4(rgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_cellSize", "u_angleMode", "u_baseAngle",
    "u_inkColor", "u_paperColor",
  ] as const) };
  return _cache;
};

export const halftoneLineGLAvailable = (): boolean => glAvailable();

export const renderHalftoneLineGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  cellSize: number, angleMode: 0 | 1 | 2, baseAngleRad: number,
  inkColor: [number, number, number], paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "halftoneLine:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_cellSize, cellSize);
    gl.uniform1i(cache.prog.uniforms.u_angleMode, angleMode);
    gl.uniform1f(cache.prog.uniforms.u_baseAngle, baseAngleRad);
    gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
