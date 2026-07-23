import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Four idealized, unprofiled CMYK AM screens. Tone is represented by exact
// geometric area: circular dots grow to contact, then complementary corner
// holes shrink to full coverage. Each screen samples its source cell.
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

vec4 sourceAt(vec2 p) {
  p = clamp(p, vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2((p.x + 0.5) / u_res.x, 1.0 - (p.y + 0.5) / u_res.y));
}

vec2 rotatePoint(vec2 point, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(point.x * c + point.y * s, -point.x * s + point.y * c);
}

float separation(vec3 rgb, int channel) {
  float k = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
  if (channel == 3) return k;
  if (k >= 1.0 - 1e-5) return 0.0;
  if (channel == 0) return clamp((1.0 - rgb.r - k) / (1.0 - k), 0.0, 1.0);
  if (channel == 1) return clamp((1.0 - rgb.g - k) / (1.0 - k), 0.0, 1.0);
  return clamp((1.0 - rgb.b - k) / (1.0 - k), 0.0, 1.0);
}

float circularSpotRank(vec2 local) {
  vec2 centred = local / u_dotSize - 0.5;
  float radius = length(centred);
  if (radius <= 0.5) return 3.14159265359 * radius * radius;
  float outsideSegment = radius * radius * acos(clamp(0.5 / radius, 0.0, 1.0))
    - 0.5 * sqrt(max(0.0, radius * radius - 0.25));
  return clamp(3.14159265359 * radius * radius - 4.0 * outsideSegment, 0.0, 1.0);
}

float screenAt(vec2 position, float angle, int channel) {
  vec2 imageCentre = u_res * 0.5;
  vec2 screened = rotatePoint(position - imageCentre, angle);
  vec2 cell = floor(screened / u_dotSize);
  vec2 screenCentre = (cell + 0.5) * u_dotSize;
  vec2 sourceCentre = rotatePoint(screenCentre, -angle) + imageCentre;
  float plateSum = 0.0;
  float alphaSum = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 sampleValue = sourceAt(sourceCentre + vec2(x, y) * u_dotSize / 3.0);
    plateSum += separation(sampleValue.rgb, channel) * sampleValue.a;
    alphaSum += sampleValue.a;
  }
  float value = alphaSum > 1e-5 ? plateSum / alphaSum : 0.0;
  if (value <= 0.0) return 0.0;
  if (value >= 1.0) return 1.0;
  float coverage = 0.0;
  for (int sy = 0; sy < 4; sy++) for (int sx = 0; sx < 4; sx++) {
    vec2 subpixel = position + vec2((float(sx) + 0.5) / 4.0 - 0.5, (float(sy) + 0.5) / 4.0 - 0.5);
    vec2 subScreened = rotatePoint(subpixel - imageCentre, angle);
    vec2 local = subScreened - floor(subScreened / u_dotSize) * u_dotSize;
    coverage += step(circularSpotRank(local), value);
  }
  return coverage / 16.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec2 position = vec2(jsX + 0.5, jsY + 0.5);
  float cVal = screenAt(position, u_angleC, 0);
  float mVal = screenAt(position, u_angleM, 1);
  float yVal = screenAt(position, u_angleY, 2);
  float kVal = screenAt(position, u_angleK, 3);
  vec3 acc = u_paperColor / 255.0;
  acc *= vec3(1.0 - cVal, 1.0 - mVal, 1.0 - yVal) * (1.0 - kVal);

  vec3 outRgb = floor(clamp(acc, 0.0, 1.0) * 255.0 + 0.5);
  float alpha = texture(u_source, v_uv).a;
  fragColor = vec4(outRgb / 255.0, alpha);
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
