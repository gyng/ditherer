import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Periodic line screen. The doubled folded phase is uniform on [0,1], so
// thresholding it by darkness makes ink area equal requested tone independent
// of pitch. Cells only choose local tone and (optionally) orientation.
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

vec2 sobelAt(float jsX, float jsY) {
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
  return vec2(atan(gy, gx), length(vec2(gx, gy)));
}

float cellMeanLuma(float cellX, float cellY) {
  float weighted = 0.0;
  float weight = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    float sx = min(u_res.x - 1.0, cellX + (float(x) + 0.5) * u_cellSize / 4.0);
    float sy = min(u_res.y - 1.0, cellY + (float(y) + 0.5) * u_cellSize / 4.0);
    vec4 sampleValue = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y));
    float alpha = sampleValue.a;
    weighted += dot(sampleValue.rgb, vec3(0.2126, 0.7152, 0.0722)) * 255.0 * alpha;
    weight += alpha;
  }
  return weight > 0.0 ? weighted / weight : 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float cellX = floor(jsX / u_cellSize) * u_cellSize;
  float cellY = floor(jsY / u_cellSize) * u_cellSize;
  float centreX = min(u_res.x - 1.0, cellX + u_cellSize * 0.5);
  float centreY = min(u_res.y - 1.0, cellY + u_cellSize * 0.5);

  float avgLum = cellMeanLuma(cellX, cellY);

  float angle = u_baseAngle;
  if (u_angleMode == 1) {
    angle += (avgLum / 255.0) * 1.57079632679;
  } else if (u_angleMode == 2) {
    vec2 gradient = sobelAt(centreX, centreY);
    if (gradient.y > 0.01) angle += gradient.x + 1.57079632679;
  }

  float darkness = clamp(1.0 - avgLum / 255.0, 0.0, 1.0);
  vec2 normal = vec2(-sin(angle), cos(angle));
  float phase = abs(fract(dot(vec2(jsX, jsY), normal) / u_cellSize + 0.5) - 0.5) * 2.0;
  float aa = max(fwidth(phase), 1e-4);
  float coverage = darkness <= 0.0 ? 0.0 : darkness >= 1.0 ? 1.0
    : 1.0 - smoothstep(darkness - aa, darkness + aa, phase);
  vec3 rgb = mix(u_paperColor, u_inkColor, coverage) / 255.0;
  fragColor = vec4(rgb, texture(u_source, v_uv).a);
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
