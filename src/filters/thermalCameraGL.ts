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
} from "gl";

// Thermal false-colour: luminance → contrast → noise → gradient sample →
// optional crosshair overlay. Gradient stops passed as a uniform vec3 array
// (up to 8 stops, zero-padded if fewer). Hash-based per-pixel noise replaces
// the mulberry32 sequence; visually equivalent.
export const THERMAL_MAX_STOPS = 8;

const THERMAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_contrast;
uniform float u_noise;
uniform float u_frameSeed;
uniform int   u_stopCount;
uniform vec3  u_stops[${THERMAL_MAX_STOPS}];
uniform int   u_crosshair;
uniform vec3  u_hotColor;
uniform float u_armLen;
uniform float u_gap;
uniform float u_levels;

float hash1(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

// Lerp along the gradient. Same formula as the CPU reference.
vec3 sampleGradient(float t) {
  float tc = clamp(t, 0.0, 1.0);
  float pos = tc * float(u_stopCount - 1);
  int idx = int(floor(pos));
  float frac = pos - float(idx);
  if (idx >= u_stopCount - 1) return u_stops[u_stopCount - 1];
  vec3 a = u_stops[idx];
  vec3 b = u_stops[idx + 1];
  return a + (b - a) * frac;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y));
  float lum = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float contrasted = clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float noise = (hash1(vec2(x, y), u_frameSeed) - 0.5) * u_noise;
  float val = clamp(contrasted + noise, 0.0, 1.0);
  vec3 rgb = sampleGradient(val);

  // Crosshair overlay — short horizontal + vertical arms with a centre gap.
  if (u_crosshair == 1) {
    float cx = floor(u_res.x * 0.5);
    float cy = floor(u_res.y * 0.5);
    float dx = abs(x - cx);
    float dy = abs(y - cy);
    bool onHArm = (y == cy) && dx >= u_gap && dx <= u_armLen + u_gap;
    bool onVArm = (x == cx) && dy >= u_gap && dy <= u_armLen + u_gap;
    if (onHArm || onVArm) rgb = u_hotColor;
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, THERMAL_FS, [
      "u_source", "u_res", "u_contrast", "u_noise", "u_frameSeed",
      "u_stopCount", "u_stops[0]",
      "u_crosshair", "u_hotColor", "u_armLen", "u_gap", "u_levels",
    ] as const),
  };
  return _cache;
};

export const thermalCameraGLAvailable = (): boolean => glAvailable();

export const renderThermalCameraGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  stops: number[][],
  contrast: number,
  noiseAmount: number,
  crosshair: boolean,
  frameIndex: number,
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const stopCount = Math.min(THERMAL_MAX_STOPS, stops.length);
  const flatStops = new Float32Array(THERMAL_MAX_STOPS * 3);
  for (let i = 0; i < stopCount; i++) {
    flatStops[i * 3] = stops[i][0];
    flatStops[i * 3 + 1] = stops[i][1];
    flatStops[i * 3 + 2] = stops[i][2];
  }
  // CPU samples the gradient at 0.85 for the hot-colour crosshair.
  const hotT = Math.min(1, Math.max(0, 0.85));
  const hotPos = hotT * (stopCount - 1);
  const hotIdx = Math.min(stopCount - 1, Math.floor(hotPos));
  const hotFrac = hotPos - hotIdx;
  const hotNext = Math.min(stopCount - 1, hotIdx + 1);
  const hotColor: [number, number, number] = [
    stops[hotIdx][0] + (stops[hotNext][0] - stops[hotIdx][0]) * hotFrac,
    stops[hotIdx][1] + (stops[hotNext][1] - stops[hotIdx][1]) * hotFrac,
    stops[hotIdx][2] + (stops[hotNext][2] - stops[hotIdx][2]) * hotFrac,
  ];
  const armLen = Math.floor(Math.min(width, height) * 0.04);
  const gap = Math.max(2, Math.floor(armLen * 0.4));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "thermalCamera:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
    gl.uniform1f(cache.prog.uniforms.u_noise, noiseAmount);
    gl.uniform1f(cache.prog.uniforms.u_frameSeed, frameIndex * 7919 + 31337);
    gl.uniform1i(cache.prog.uniforms.u_stopCount, stopCount);
    const locStops = cache.prog.uniforms["u_stops[0]"];
    if (locStops) gl.uniform3fv(locStops, flatStops);
    gl.uniform1i(cache.prog.uniforms.u_crosshair, crosshair ? 1 : 0);
    gl.uniform3f(cache.prog.uniforms.u_hotColor, hotColor[0], hotColor[1], hotColor[2]);
    gl.uniform1f(cache.prog.uniforms.u_armLen, armLen);
    gl.uniform1f(cache.prog.uniforms.u_gap, gap);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
